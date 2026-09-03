import {
  err,
  LIMITS,
  ok,
  RATE_LIMITS,
  type Attachment,
  type DraftMessage,
  type Message,
  type Reaction,
  type Result,
  type ServerEvent,
} from '@huddle/core';
import { channelMembers, channels, messages, type Database, type MessageRow } from '@huddle/db';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { outranks } from './access.js';
import { requireChannel, type ChannelError } from './channels.js';
import { notifyNewMessage } from './notifications.js';

export type MessageError = ChannelError | 'rate_limited' | 'invalid';

export interface MessagePage {
  messages: Message[];
  /** Highest sequence in the channel, whether or not it is in this page. */
  latestSeq: number;
  hasMore: boolean;
}

const MINUTE_SECONDS = 60;

/**
 * The one write path for messages.
 *
 * The sequence number is claimed by incrementing the channel row inside the
 * same transaction that inserts the message. Postgres holds a row lock for the
 * duration, so two concurrent sends into one channel serialise against each
 * other and can never take the same number, no matter how many app instances
 * are running. That single guarantee is what reconnect, ordering and unread
 * counts all rest on.
 */
export async function sendMessage(
  ctx: AppContext,
  input: { channelId: string; userId: string; draft: DraftMessage },
): Promise<Result<Message, MessageError>> {
  const sends = await ctx.kv.increment(`rl:send:${input.userId}`, MINUTE_SECONDS);
  if (sends > RATE_LIMITS.sendMessagePerMinute) return err('rate_limited');

  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const { channel, joined } = access.value;
  if (channel.archivedAt !== null) return err('archived');

  const now = ctx.now();

  // Posting into a public channel is itself the act of joining it. Making
  // people press join first is a step that exists only in the data model.
  if (!joined) {
    await ctx.db
      .insert(channelMembers)
      .values({ channelId: channel.id, userId: input.userId, joinedAt: now })
      .onConflictDoNothing();
  }

  const message = await ctx.db.transaction(async (tx) => {
    // A resent client id is a retry from a flaky network, not a new message.
    const existing = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, input.draft.id))
      .limit(1);
    if (existing[0]) return toMessage(existing[0]);

    const bumped = await tx
      .update(channels)
      .set({ lastSeq: sql`${channels.lastSeq} + 1`, lastMessageAt: now })
      .where(eq(channels.id, channel.id))
      .returning({ seq: channels.lastSeq });

    const seq = bumped[0]?.seq;
    if (seq === undefined) throw new Error('Channel vanished while sending');

    const inserted = await tx
      .insert(messages)
      .values({
        id: input.draft.id,
        channelId: channel.id,
        seq,
        authorId: input.userId,
        body: input.draft.body,
        text: input.draft.text,
        parentId: input.draft.parentId,
        attachments: input.draft.attachments,
        reactions: [],
        mentions: input.draft.mentions,
        createdAt: now,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Insert did not persist');

    // The parent carries the count, in the same transaction, so a reply and
    // the number next to it can never disagree.
    if (input.draft.parentId !== null) {
      await tx
        .update(messages)
        .set({ replyCount: sql`${messages.replyCount} + 1` })
        .where(and(eq(messages.id, input.draft.parentId), eq(messages.channelId, channel.id)));
    }

    return toMessage(row);
  });

  await markCaughtUp(ctx.db, channel.id, input.userId, message.seq);
  await bumpMentions(ctx.db, channel.id, input.userId, message.mentions);

  ctx.hub.publish(channel.id, {
    type: 'message',
    channelId: channel.id,
    message,
    ref: input.draft.id,
  });

  // The channel view shows the parent, not the reply, so the count beside it
  // has to be told that it moved.
  if (message.parentId !== null) {
    const parent = await readMessage(ctx, channel.id, message.parentId);
    if (parent) {
      ctx.hub.publish(channel.id, {
        type: 'message_updated',
        channelId: channel.id,
        message: parent,
      });
    }
  }

  // After the response, never before it. A slow push service must not be able
  // to hold up the send.
  ctx.background('notify', () => notifyNewMessage(ctx, { channel, message }));

  return ok(message);
}

export async function editMessage(
  ctx: AppContext,
  input: { channelId: string; userId: string; messageId: string; body: string; text: string },
): Promise<Result<Message, MessageError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);
  if (access.value.channel.archivedAt !== null) return err('archived');

  const updated = await ctx.db
    .update(messages)
    .set({ body: input.body, text: input.text, editedAt: ctx.now() })
    .where(
      and(
        eq(messages.id, input.messageId),
        eq(messages.channelId, input.channelId),
        eq(messages.authorId, input.userId),
        sql`${messages.deletedAt} IS NULL`,
      ),
    )
    .returning();

  // Only the author may edit, so an empty result is a missing message or
  // someone else's, and the caller is told the same thing either way.
  const row = updated[0];
  if (!row) return err('not_found');

  const message = toMessage(row);
  ctx.hub.publish(input.channelId, {
    type: 'message_updated',
    channelId: input.channelId,
    message,
  });

  return ok(message);
}

export async function deleteMessage(
  ctx: AppContext,
  input: { channelId: string; userId: string; messageId: string },
): Promise<Result<{ messageId: string; seq: number }, MessageError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const found = await ctx.db
    .select({ authorId: messages.authorId, seq: messages.seq, deletedAt: messages.deletedAt })
    .from(messages)
    .where(and(eq(messages.id, input.messageId), eq(messages.channelId, input.channelId)))
    .limit(1);

  const existing = found[0];
  if (!existing || existing.deletedAt !== null) return err('not_found');

  const isAuthor = existing.authorId === input.userId;
  if (!isAuthor && !outranks(access.value.role, 'admin')) return err('forbidden');

  // The row stays so `seq` remains dense and a reconnecting client still
  // learns the message is gone. Only its content is cleared.
  await ctx.db
    .update(messages)
    .set({
      deletedAt: ctx.now(),
      body: '""',
      text: '',
      attachments: [],
      reactions: [],
      mentions: [],
    })
    .where(eq(messages.id, input.messageId));

  ctx.hub.publish(input.channelId, {
    type: 'message_deleted',
    channelId: input.channelId,
    messageId: input.messageId,
    seq: existing.seq,
  });

  return ok({ messageId: input.messageId, seq: existing.seq });
}

export async function toggleReaction(
  ctx: AppContext,
  input: { channelId: string; userId: string; messageId: string; emoji: string; on: boolean },
): Promise<Result<Reaction[], MessageError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);
  if (access.value.channel.archivedAt !== null) return err('archived');

  const next = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select({ reactions: messages.reactions, deletedAt: messages.deletedAt })
      .from(messages)
      .where(and(eq(messages.id, input.messageId), eq(messages.channelId, input.channelId)))
      .for('update')
      .limit(1);

    const row = rows[0];
    if (!row || row.deletedAt !== null) return null;

    const reactions = applyReaction(row.reactions as Reaction[], input);
    await tx.update(messages).set({ reactions }).where(eq(messages.id, input.messageId));
    return reactions;
  });

  if (!next) return err('not_found');

  ctx.hub.publish(input.channelId, {
    type: 'reactions',
    channelId: input.channelId,
    messageId: input.messageId,
    reactions: next,
  });

  return ok(next);
}

export async function fetchHistory(
  ctx: AppContext,
  input: { channelId: string; userId: string; before?: number; limit: number },
): Promise<Result<MessagePage, MessageError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const limit = Math.min(input.limit, LIMITS.reconnectReplayMax);
  const rows = await ctx.db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.channelId, input.channelId),
        // A thread reply belongs to its thread. Letting it into the channel
        // view would also make every page a different size than it claims.
        isNull(messages.parentId),
        input.before === undefined ? undefined : lt(messages.seq, input.before),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return ok({
    messages: page.reverse().map(toMessage),
    latestSeq: access.value.lastSeq,
    hasMore,
  });
}

/**
 * The reconnect path. Replies are included, unlike the channel view, because a
 * client with a thread open has to catch up on it too and routes by parent id.
 *
 * A client that has been away sends the last sequence it
 * holds and gets the delta, which is the same mechanism that covers a
 * backgrounded phone and a dropped train connection.
 */
export async function syncSince(
  ctx: AppContext,
  input: { channelId: string; userId: string; afterSeq: number },
): Promise<Result<MessagePage, MessageError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const rows = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.channelId, input.channelId), gt(messages.seq, input.afterSeq)))
    .orderBy(asc(messages.seq))
    .limit(LIMITS.reconnectReplayMax + 1);

  const hasMore = rows.length > LIMITS.reconnectReplayMax;
  const page = hasMore ? rows.slice(0, LIMITS.reconnectReplayMax) : rows;

  return ok({ messages: page.map(toMessage), latestSeq: access.value.lastSeq, hasMore });
}

export async function fetchThread(
  ctx: AppContext,
  input: { channelId: string; userId: string; parentId: string; limit: number },
): Promise<Result<{ parent: Message; page: MessagePage }, MessageError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const parentRows = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.id, input.parentId), eq(messages.channelId, input.channelId)))
    .limit(1);

  const parent = parentRows[0];
  if (!parent) return err('not_found');

  const rows = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.channelId, input.channelId), eq(messages.parentId, input.parentId)))
    .orderBy(asc(messages.seq))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  return ok({
    parent: toMessage(parent),
    page: { messages: page.map(toMessage), latestSeq: access.value.lastSeq, hasMore },
  });
}

export async function markRead(
  ctx: AppContext,
  input: { channelId: string; userId: string; seq: number },
): Promise<Result<{ readSeq: number }, MessageError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);
  if (!access.value.joined) return ok({ readSeq: input.seq });

  const caughtUp = input.seq >= access.value.lastSeq;

  await ctx.db
    .update(channelMembers)
    .set({
      readSeq: sql`GREATEST(${channelMembers.readSeq}, ${input.seq})`,
      ...(caughtUp ? { mentionCount: 0 } : {}),
    })
    .where(
      and(eq(channelMembers.channelId, input.channelId), eq(channelMembers.userId, input.userId)),
    );

  ctx.hub.publish(input.channelId, {
    type: 'read',
    channelId: input.channelId,
    userId: input.userId,
    seq: input.seq,
  });

  return ok({ readSeq: input.seq });
}

export async function markTyping(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<Result<null, MessageError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  ctx.hub.markTyping(input.channelId, input.userId);
  return ok(null);
}

/** Used by the cross instance relay when an event was too large to send inline. */
export async function hydrateMessageEvent(
  db: Database,
  channelId: string,
  messageId: string,
  kind: 'message' | 'message_updated',
): Promise<ServerEvent | null> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return { type: kind, channelId, message: toMessage(row) };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channelId: row.channelId,
    seq: row.seq,
    authorId: row.authorId,
    body: row.body,
    text: row.text,
    parentId: row.parentId,
    replyCount: row.replyCount,
    attachments: row.attachments as Attachment[],
    reactions: row.reactions as Reaction[],
    mentions: row.mentions as string[],
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
  };
}

function applyReaction(
  current: Reaction[],
  input: { userId: string; emoji: string; on: boolean },
): Reaction[] {
  const reactions = current.map((reaction) => ({ ...reaction, userIds: [...reaction.userIds] }));
  let reaction = reactions.find((candidate) => candidate.emoji === input.emoji);

  if (!reaction) {
    if (!input.on) return reactions;
    reaction = { emoji: input.emoji, userIds: [] };
    reactions.push(reaction);
  }

  const has = reaction.userIds.includes(input.userId);
  if (input.on && !has) reaction.userIds.push(input.userId);
  if (!input.on && has) {
    reaction.userIds = reaction.userIds.filter((id) => id !== input.userId);
  }

  return reactions.filter((entry) => entry.userIds.length > 0);
}

async function readMessage(
  ctx: AppContext,
  channelId: string,
  messageId: string,
): Promise<Message | null> {
  const rows = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
    .limit(1);

  const row = rows[0];
  return row ? toMessage(row) : null;
}

async function markCaughtUp(
  db: Database,
  channelId: string,
  userId: string,
  seq: number,
): Promise<void> {
  await db
    .update(channelMembers)
    .set({ readSeq: seq })
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
}

async function bumpMentions(
  db: Database,
  channelId: string,
  authorId: string,
  mentions: string[],
): Promise<void> {
  const targets = mentions.filter((id) => id !== authorId);
  if (targets.length === 0) return;

  await db
    .update(channelMembers)
    .set({ mentionCount: sql`${channelMembers.mentionCount} + 1` })
    .where(and(eq(channelMembers.channelId, channelId), inArray(channelMembers.userId, targets)));
}
