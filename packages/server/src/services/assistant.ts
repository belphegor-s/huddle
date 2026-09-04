import { err, ok, type Message, type Result } from '@huddle/core';
import { users } from '@huddle/db';
import { inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import type { AiMessage } from '../storage/ai.js';
import { requireChannel } from './channels.js';
import { fetchThread, syncSince, type MessageError } from './messages.js';

export type AssistantError =
  MessageError | 'unavailable' | 'rate_limited' | 'nothing_to_read' | 'encrypted';

/** Enough for a long thread, short enough that a reply comes back quickly. */
const MAX_MESSAGES = 200;
const MAX_TRANSCRIPT_CHARS = 24_000;
const MAX_TOKENS = 700;
const HOUR_SECONDS = 60 * 60;
const REQUESTS_PER_HOUR = 60;

/**
 * The AI features, all of which are the same shape: take messages the caller
 * can already read, hand them to the model, return prose.
 *
 * Nothing is stored. A summary is a view of the conversation, not a message in
 * it, so it cannot drift from the thread it describes and cannot be edited
 * into something the thread never said.
 */
export async function summariseThread(
  ctx: AppContext,
  input: { channelId: string; userId: string; parentId: string },
): Promise<Result<string, AssistantError>> {
  const guard = await ready(ctx, input);
  if (!guard.ok) return err(guard.error);

  const thread = await fetchThread(ctx, {
    channelId: input.channelId,
    userId: input.userId,
    parentId: input.parentId,
    limit: MAX_MESSAGES,
  });
  if (!thread.ok) return err(thread.error);

  const transcript = await render(ctx, [thread.value.parent, ...thread.value.page.messages]);
  if (transcript === '') return err('nothing_to_read');

  return ask(ctx, [
    {
      role: 'system',
      content: [
        'You summarise a chat thread for someone who has not read it.',
        'Lead with what was decided, or say plainly that nothing was decided.',
        'Then list anything left open, and who it is waiting on.',
        'Use at most six short lines. No preamble, no sign off, no markdown headings.',
        'Only use what is in the transcript. If it is unclear, say so rather than guessing.',
      ].join(' '),
    },
    { role: 'user', content: transcript },
  ]);
}

/**
 * What someone missed while they were away, from their own read position, so
 * two people asking at the same moment get different and correct answers.
 */
export async function catchUp(
  ctx: AppContext,
  input: { channelId: string; userId: string; sinceSeq: number },
): Promise<Result<string, AssistantError>> {
  const guard = await ready(ctx, input);
  if (!guard.ok) return err(guard.error);

  const missed = await syncSince(ctx, {
    channelId: input.channelId,
    userId: input.userId,
    afterSeq: input.sinceSeq,
  });
  if (!missed.ok) return err(missed.error);

  const recent = missed.value.messages.slice(-MAX_MESSAGES);
  const transcript = await render(ctx, recent);
  if (transcript === '') return err('nothing_to_read');

  return ask(ctx, [
    {
      role: 'system',
      content: [
        'You tell someone what they missed in a chat channel while they were away.',
        'Group by topic rather than replaying the messages in order.',
        'Call out anything addressed to them or waiting on them.',
        'Use at most six short lines. No preamble, no sign off, no markdown headings.',
        'Only use what is in the transcript.',
      ].join(' '),
    },
    { role: 'user', content: transcript },
  ]);
}

async function ready(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<Result<null, AssistantError>> {
  if (!ctx.ai.available) return err('unavailable');

  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  // There is nothing to summarise. The server holds ciphertext, and sending
  // that to a model would be theatre.
  if (access.value.channel.encrypted) return err('encrypted');

  // Per person rather than per instance: one enthusiastic user should not be
  // able to spend the whole deployment's budget.
  const used = await ctx.kv.increment(`rl:ai:${input.userId}`, HOUR_SECONDS);
  if (used > REQUESTS_PER_HOUR) return err('rate_limited');

  return ok(null);
}

async function ask(
  ctx: AppContext,
  messages: AiMessage[],
): Promise<Result<string, AssistantError>> {
  try {
    const answer = await ctx.ai.complete({ messages, maxTokens: MAX_TOKENS });
    const trimmed = answer.trim();
    return trimmed === '' ? err('nothing_to_read') : ok(trimmed);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'ai_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return err('unavailable');
  }
}

/**
 * A plain transcript with display names, oldest first. Attachments are named
 * rather than dropped, because "sent the deck" is often the whole point of a
 * message.
 */
async function render(ctx: AppContext, messages: Message[]): Promise<string> {
  const alive = messages.filter((message) => message.deletedAt === null);
  if (alive.length === 0) return '';

  const authorIds = [...new Set(alive.map((message) => message.authorId))];
  const rows = await ctx.db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, authorIds));

  const names = new Map(rows.map((row) => [row.id, row.displayName]));
  const lines: string[] = [];
  let size = 0;

  // Built from the newest backwards, so a transcript that has to be cut keeps
  // the end of the conversation rather than the beginning.
  for (const message of [...alive].reverse()) {
    const attachments = message.attachments.map((file) => `[${file.kind}: ${file.name}]`).join(' ');
    const body = [message.text.trim(), attachments].filter(Boolean).join(' ');
    if (body === '') continue;

    const line = `${names.get(message.authorId) ?? 'Someone'}: ${body}`;
    if (size + line.length > MAX_TRANSCRIPT_CHARS) break;

    lines.push(line);
    size += line.length + 1;
  }

  return lines.reverse().join('\n');
}
