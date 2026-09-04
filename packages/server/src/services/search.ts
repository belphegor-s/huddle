import { err, ok, type Result, type SearchInput } from '@huddle/core';
import { channelMembers, channels, messages } from '@huddle/db';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { requireMember, type AccessError } from './access.js';
import { isDmKey } from './channels.js';

/**
 * Match markers, not HTML.
 *
 * `ts_headline` splices its markers into the message text verbatim, so asking
 * it for `<mark>` would hand the client a string it could only render by
 * trusting message content as markup. Control characters cannot appear in a
 * message body, so the client splits on these and builds real elements.
 */
export const MATCH_START = '';
export const MATCH_END = '';

const HEADLINE_OPTIONS = `StartSel=${MATCH_START},StopSel=${MATCH_END},MaxWords=24,MinWords=8,HighlightAll=FALSE`;

export interface SearchResult {
  messageId: string;
  channelId: string;
  channelName: string | null;
  authorId: string;
  /** Segments are separated by the match markers above. Never markup. */
  snippet: string;
  createdAt: number;
  score: number;
}

/**
 * The readable set is computed from membership on every query rather than
 * cached, because a search that returns a message from a channel someone was
 * removed from yesterday is a leak that no cache invalidation story survives.
 */
export async function searchMessages(
  ctx: AppContext,
  input: { workspaceId: string; userId: string; query: SearchInput },
): Promise<Result<SearchResult[], AccessError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err(member.error);

  const readable = await ctx.db
    .select({ id: channels.id, name: channels.name })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(
      and(
        eq(channelMembers.userId, input.userId),
        eq(channels.workspaceId, input.workspaceId),
        // An encrypted channel stores no text to match. Leaving it in would
        // only ever return nothing, which reads as a broken search rather
        // than as the deliberate cost of the server not being able to read.
        eq(channels.encrypted, false),
      ),
    );

  const names = new Map(readable.map((row) => [row.id, isDmKey(row.name) ? null : row.name]));
  const channelIds =
    input.query.channelId === undefined
      ? [...names.keys()]
      : names.has(input.query.channelId)
        ? [input.query.channelId]
        : [];

  if (channelIds.length === 0) return ok([]);

  const q = input.query;
  const tsQuery = sql`plainto_tsquery('simple', ${q.text})`;
  const rank = sql<number>`ts_rank(to_tsvector('simple', ${messages.text}), ${tsQuery})`;

  const rows = await ctx.db
    .select({
      messageId: messages.id,
      channelId: messages.channelId,
      authorId: messages.authorId,
      createdAt: messages.createdAt,
      snippet: sql<string>`ts_headline('simple', ${messages.text}, ${tsQuery}, ${HEADLINE_OPTIONS})`,
      score: rank,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.channelId, channelIds),
        isNull(messages.deletedAt),
        sql`to_tsvector('simple', ${messages.text}) @@ ${tsQuery}`,
        q.authorId === undefined ? undefined : eq(messages.authorId, q.authorId),
        q.hasFile === undefined
          ? undefined
          : q.hasFile
            ? sql`jsonb_array_length(${messages.attachments}) > 0`
            : sql`jsonb_array_length(${messages.attachments}) = 0`,
        q.after === undefined ? undefined : gte(messages.createdAt, q.after),
        q.before === undefined ? undefined : lte(messages.createdAt, q.before),
      ),
    )
    .orderBy(desc(rank), desc(messages.createdAt))
    .limit(q.limit);

  return ok(
    rows.map((row) => ({
      messageId: row.messageId,
      channelId: row.channelId,
      channelName: names.get(row.channelId) ?? null,
      authorId: row.authorId,
      snippet: row.snippet,
      createdAt: Number(row.createdAt),
      score: Number(row.score),
    })),
  );
}
