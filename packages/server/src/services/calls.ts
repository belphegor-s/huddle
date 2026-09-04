import { err, LIMITS, ok, type CallParticipant, type Result } from '@huddle/core';
import { callParticipants } from '@huddle/db';
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { channelMemberIds, requireChannel, type ChannelError } from './channels.js';

export type CallError = ChannelError | 'call_full' | 'not_in_call';

/**
 * A call is a roster and a relay for the browsers to find each other. No media
 * touches this process: peers connect directly, and the server's whole job is
 * to say who is present and to pass session descriptions between them.
 *
 * The roster lives in Postgres rather than in the hub because every instance
 * has to agree on it, and because a caller who reloads the page must find the
 * call still there. Rows are heartbeated, so an instance dying leaves a ghost
 * for seconds rather than a room nobody can rejoin.
 */

interface Presence {
  channelId: string;
  userId: string;
  sessionId: string;
}

export async function joinCall(
  ctx: AppContext,
  input: Presence & { video: boolean },
): Promise<Result<CallParticipant[], CallError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);
  if (access.value.channel.archivedAt !== null) return err('archived');

  await sweepStale(ctx, input.channelId);
  const present = await roster(ctx, input.channelId);

  // Rejoining from the same connection is a no op rather than a rejection,
  // so a reconnect during a call does not need the client to know it left.
  const already = present.some((participant) => participant.sessionId === input.sessionId);
  if (!already && present.length >= LIMITS.callParticipantsMax) return err('call_full');

  const now = ctx.now();
  await ctx.db
    .insert(callParticipants)
    .values({
      sessionId: input.sessionId,
      channelId: input.channelId,
      userId: input.userId,
      muted: false,
      videoOn: input.video,
      sharing: false,
      joinedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: callParticipants.sessionId,
      set: { channelId: input.channelId, videoOn: input.video, lastSeenAt: now },
    });

  return ok(await announce(ctx, input.channelId));
}

/** Keyed by connection alone: you can only ever remove your own. */
export async function leaveCall(ctx: AppContext, input: { sessionId: string }): Promise<void> {
  const removed = await ctx.db
    .delete(callParticipants)
    .where(eq(callParticipants.sessionId, input.sessionId))
    .returning({ channelId: callParticipants.channelId });

  const channelId = removed[0]?.channelId;
  if (channelId === undefined) return;

  await announce(ctx, channelId);
}

export async function updateCallState(
  ctx: AppContext,
  input: { sessionId: string; muted: boolean; video: boolean; sharing: boolean },
): Promise<Result<CallParticipant[], CallError>> {
  const updated = await ctx.db
    .update(callParticipants)
    .set({
      muted: input.muted,
      videoOn: input.video,
      sharing: input.sharing,
      lastSeenAt: ctx.now(),
    })
    .where(eq(callParticipants.sessionId, input.sessionId))
    .returning({ channelId: callParticipants.channelId });

  // The channel comes from the row, not from the caller, so a frame naming
  // somebody else's channel cannot make the roster there be republished.
  const channelId = updated[0]?.channelId;
  if (channelId === undefined) return err('not_in_call');

  return ok(await announce(ctx, channelId));
}

/** Cheap and frequent: it proves the row is still wanted and nothing else. */
export async function heartbeatCall(ctx: AppContext, input: { sessionId: string }): Promise<void> {
  await ctx.db
    .update(callParticipants)
    .set({ lastSeenAt: ctx.now() })
    .where(eq(callParticipants.sessionId, input.sessionId));
}

/**
 * Forwards an offer, an answer or a candidate to one other participant.
 *
 * The payload is never parsed. What is checked is that both ends are in this
 * call, which is what stops the relay being a way to push arbitrary bytes at
 * somebody who is not expecting them.
 */
export async function relaySignal(
  ctx: AppContext,
  input: Presence & { to: string; data: string },
): Promise<Result<null, CallError>> {
  const present = await roster(ctx, input.channelId);

  const from = present.find((participant) => participant.sessionId === input.sessionId);
  if (!from || from.userId !== input.userId) return err('not_in_call');

  const target = present.find((participant) => participant.sessionId === input.to);
  if (!target) return err('not_found');

  ctx.hub.publishToUser(target.userId, {
    type: 'call_signal',
    channelId: input.channelId,
    from: input.sessionId,
    fromUserId: input.userId,
    to: input.to,
    data: input.data,
  });

  return ok(null);
}

export async function roster(ctx: AppContext, channelId: string): Promise<CallParticipant[]> {
  const rows = await ctx.db
    .select()
    .from(callParticipants)
    .where(
      and(
        eq(callParticipants.channelId, channelId),
        gt(callParticipants.lastSeenAt, ctx.now() - LIMITS.callStaleMs),
      ),
    );

  return rows
    .map((row) => ({
      sessionId: row.sessionId,
      userId: row.userId,
      muted: row.muted,
      video: row.videoOn,
      sharing: row.sharing,
      joinedAt: row.joinedAt,
    }))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.sessionId.localeCompare(b.sessionId));
}

/** How many are in a call in each of these channels, for the channel list. */
export async function callCounts(
  ctx: AppContext,
  channelIds: string[],
): Promise<Map<string, number>> {
  if (channelIds.length === 0) return new Map();

  const rows = await ctx.db
    .select({ channelId: callParticipants.channelId, count: sql<number>`count(*)::int` })
    .from(callParticipants)
    .where(
      and(
        inArray(callParticipants.channelId, channelIds),
        gt(callParticipants.lastSeenAt, ctx.now() - LIMITS.callStaleMs),
      ),
    )
    .groupBy(callParticipants.channelId);

  return new Map(rows.map((row) => [row.channelId, row.count]));
}

/**
 * The roster to everyone watching the call, and a count to every member of the
 * channel. The second is what puts the dot in the sidebar for somebody who is
 * looking at a different conversation and would otherwise never know.
 */
async function announce(ctx: AppContext, channelId: string): Promise<CallParticipant[]> {
  const participants = await roster(ctx, channelId);

  const frame = { type: 'call_roster', channelId, participants } as const;
  ctx.hub.publish(channelId, frame);

  // Again, straight to each caller. A person who walked to another channel is
  // still in the call but no longer subscribed to it, and would otherwise stop
  // hearing about anybody who arrived after they left the screen.
  for (const participant of participants) ctx.hub.publishToUser(participant.userId, frame);

  const members = await channelMemberIds(ctx, channelId);
  for (const userId of members) {
    ctx.hub.publishToUser(userId, {
      type: 'call_activity',
      channelId,
      count: participants.length,
    });
  }

  return participants;
}

async function sweepStale(ctx: AppContext, channelId: string): Promise<void> {
  await ctx.db
    .delete(callParticipants)
    .where(
      and(
        eq(callParticipants.channelId, channelId),
        lt(callParticipants.lastSeenAt, ctx.now() - LIMITS.callStaleMs),
      ),
    );
}
