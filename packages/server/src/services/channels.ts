import {
  err,
  isUlid,
  ok,
  ulid,
  type Channel,
  type ChannelSummary,
  type CreateChannelInput,
  type Result,
  type Role,
  type UpdateChannelInput,
  type UpdateChannelPrefsInput,
} from '@huddle/core';
import { channelMembers, channels, memberships } from '@huddle/db';
import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { outranks, requireMember, type AccessError } from './access.js';

export type ChannelError = AccessError | 'not_found' | 'name_taken' | 'archived';

export interface ChannelAccess {
  channel: Channel;
  /** Role in the workspace, not in the channel. Channels have no roles. */
  role: Role;
  joined: boolean;
  /** The channel's current head sequence, so callers avoid a second read. */
  lastSeq: number;
}

/**
 * The channel level half of the tenant boundary. It always runs `requireMember`
 * first, so a channel id from another workspace cannot be reached by guessing.
 *
 * A private channel the caller is not in answers `not_found` rather than
 * `forbidden`, because confirming that it exists is itself the leak.
 */
export async function requireChannel(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<Result<ChannelAccess, ChannelError>> {
  const rows = await ctx.db
    .select()
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1);

  const channel = rows[0];
  if (!channel) return err('not_found');

  const member = await requireMember(ctx.db, {
    workspaceId: channel.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err('not_found');

  const joined = await isChannelMember(ctx, input.channelId, input.userId);
  if (!joined && (channel.isPrivate || channel.kind !== 'channel')) return err('not_found');

  return ok({
    channel: toChannel(channel),
    role: member.value.role,
    joined,
    lastSeq: channel.lastSeq,
  });
}

export async function createChannel(
  ctx: AppContext,
  input: { workspaceId: string; userId: string } & CreateChannelInput,
): Promise<Result<ChannelSummary, AccessError | 'name_taken'>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    minimumRole: 'member',
  });
  if (!member.ok) return err(member.error);

  const now = ctx.now();
  const created = await ctx.db
    .insert(channels)
    .values({
      id: ulid(now),
      workspaceId: input.workspaceId,
      kind: 'channel',
      name: input.name,
      topic: input.topic,
      isPrivate: input.isPrivate,
      createdBy: input.userId,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();

  const channel = created[0];
  if (!channel) return err('name_taken');

  await ctx.db
    .insert(channelMembers)
    .values({ channelId: channel.id, userId: input.userId, joinedAt: now });

  return ok(emptySummary(toChannel(channel)));
}

/**
 * A conversation is keyed by its exact member set, so opening a DM with the
 * same people twice lands in the same room rather than forking history.
 */
export async function openDm(
  ctx: AppContext,
  input: { workspaceId: string; userId: string; userIds: string[] },
): Promise<Result<ChannelSummary, AccessError | 'not_found'>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err(member.error);

  const participants = [...new Set([input.userId, ...input.userIds])].sort();
  if (participants.length < 2) return err('not_found');

  const present = await ctx.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, input.workspaceId),
        inArray(memberships.userId, participants),
      ),
    );
  if (present.length !== participants.length) return err('not_found');

  const key = dmKey(participants);
  const now = ctx.now();

  const created = await ctx.db
    .insert(channels)
    .values({
      id: ulid(now),
      workspaceId: input.workspaceId,
      kind: participants.length > 2 ? 'group_dm' : 'dm',
      name: key,
      topic: null,
      isPrivate: true,
      createdBy: input.userId,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();

  const channel = created[0] ?? (await findByName(ctx, input.workspaceId, key));
  if (!channel) return err('not_found');

  await joinAll(ctx, channel.id, participants, now);
  return ok({
    ...emptySummary(toChannel(channel)),
    lastSeq: channel.lastSeq,
    lastMessageAt: channel.lastMessageAt,
    memberIds: participants,
  });
}

/** The sidebar: channels the caller has joined, most recently active first. */
export async function listChannels(
  ctx: AppContext,
  input: { workspaceId: string; userId: string },
): Promise<Result<ChannelSummary[], AccessError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err(member.error);

  const rows = await ctx.db
    .select({ channel: channels, membership: channelMembers })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(
      and(
        eq(channelMembers.userId, input.userId),
        eq(channels.workspaceId, input.workspaceId),
        isNull(channels.archivedAt),
      ),
    )
    .orderBy(desc(channels.lastMessageAt), asc(channels.name));

  const dmIds = rows.filter((row) => row.channel.kind !== 'channel').map((row) => row.channel.id);
  const dmMembers = await membersOf(ctx, dmIds);
  const now = ctx.now();

  return ok(
    rows.map((row) => ({
      channel: toChannel(row.channel),
      lastSeq: row.channel.lastSeq,
      lastMessageAt: row.channel.lastMessageAt,
      readSeq: row.membership.readSeq,
      unreadCount: Math.max(0, row.channel.lastSeq - row.membership.readSeq),
      mentionCount: row.membership.mentionCount,
      notificationLevel: row.membership.notificationLevel,
      muted: (row.membership.mutedUntil ?? 0) > now,
      memberIds: dmMembers.get(row.channel.id) ?? [],
    })),
  );
}

/** Public channels in the workspace that the caller has not joined yet. */
export async function browseChannels(
  ctx: AppContext,
  input: { workspaceId: string; userId: string },
): Promise<Result<Channel[], AccessError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err(member.error);

  const joined = ctx.db
    .select({ id: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, input.userId));

  const rows = await ctx.db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.workspaceId, input.workspaceId),
        eq(channels.kind, 'channel'),
        eq(channels.isPrivate, false),
        isNull(channels.archivedAt),
        notInArray(channels.id, joined),
      ),
    )
    .orderBy(asc(channels.name));

  return ok(rows.map(toChannel));
}

/**
 * URLs carry a channel name where there is one, so `/c/general` is a real
 * address. DMs have no name a person would type, so they resolve by id.
 */
export async function findChannelByRef(
  ctx: AppContext,
  input: { workspaceId: string; userId: string; ref: string },
): Promise<Result<ChannelAccess, ChannelError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err(member.error);

  const rows = await ctx.db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        eq(channels.workspaceId, input.workspaceId),
        isUlid(input.ref) ? eq(channels.id, input.ref) : eq(channels.name, input.ref),
      ),
    )
    .limit(1);

  const found = rows[0];
  if (!found) return err('not_found');

  return requireChannel(ctx, { channelId: found.id, userId: input.userId });
}

export async function joinChannel(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<Result<ChannelSummary, ChannelError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);
  if (access.value.channel.archivedAt !== null) return err('archived');

  await ctx.db
    .insert(channelMembers)
    .values({
      channelId: input.channelId,
      userId: input.userId,
      joinedAt: ctx.now(),
      // Someone joining an existing channel starts caught up rather than
      // staring at a badge for every message sent before they arrived.
      readSeq: access.value.lastSeq,
    })
    .onConflictDoNothing();

  return ok({
    ...emptySummary(access.value.channel),
    lastSeq: access.value.lastSeq,
    readSeq: access.value.lastSeq,
  });
}

export async function leaveChannel(
  ctx: AppContext,
  input: { channelId: string; userId: string },
): Promise<Result<null, ChannelError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  await ctx.db
    .delete(channelMembers)
    .where(
      and(eq(channelMembers.channelId, input.channelId), eq(channelMembers.userId, input.userId)),
    );

  return ok(null);
}

export async function updateChannel(
  ctx: AppContext,
  input: { channelId: string; userId: string; patch: UpdateChannelInput },
): Promise<Result<Channel, ChannelError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);

  const { channel, role } = access.value;
  if (channel.kind !== 'channel') return err('not_found');
  if (channel.createdBy !== input.userId && !outranks(role, 'admin')) return err('forbidden');

  const now = ctx.now();
  const updated = await ctx.db
    .update(channels)
    .set({
      ...(input.patch.name === undefined ? {} : { name: input.patch.name }),
      ...(input.patch.topic === undefined ? {} : { topic: input.patch.topic }),
      ...(input.patch.archived === undefined
        ? {}
        : { archivedAt: input.patch.archived ? now : null }),
    })
    .where(eq(channels.id, input.channelId))
    .returning();

  const row = updated[0];
  if (!row) return err('not_found');
  return ok(toChannel(row));
}

export async function setChannelPrefs(
  ctx: AppContext,
  input: { channelId: string; userId: string; patch: UpdateChannelPrefsInput },
): Promise<Result<null, ChannelError>> {
  const access = await requireChannel(ctx, input);
  if (!access.ok) return err(access.error);
  if (!access.value.joined) return err('not_found');

  await ctx.db
    .update(channelMembers)
    .set({
      ...(input.patch.notificationLevel === undefined
        ? {}
        : { notificationLevel: input.patch.notificationLevel }),
      ...(input.patch.mutedUntil === undefined ? {} : { mutedUntil: input.patch.mutedUntil }),
    })
    .where(
      and(eq(channelMembers.channelId, input.channelId), eq(channelMembers.userId, input.userId)),
    );

  return ok(null);
}

export async function channelMemberIds(ctx: AppContext, channelId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId));

  return rows.map((row) => row.userId);
}

async function isChannelMember(
  ctx: AppContext,
  channelId: string,
  userId: string,
): Promise<boolean> {
  const rows = await ctx.db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);

  return rows.length > 0;
}

async function findByName(
  ctx: AppContext,
  workspaceId: string,
  name: string,
): Promise<typeof channels.$inferSelect | undefined> {
  const rows = await ctx.db
    .select()
    .from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, name)))
    .limit(1);

  return rows[0];
}

async function joinAll(
  ctx: AppContext,
  channelId: string,
  userIds: string[],
  now: number,
): Promise<void> {
  await ctx.db
    .insert(channelMembers)
    .values(userIds.map((userId) => ({ channelId, userId, joinedAt: now })))
    .onConflictDoNothing();
}

async function membersOf(ctx: AppContext, channelIds: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (channelIds.length === 0) return grouped;

  const rows = await ctx.db
    .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
    .from(channelMembers)
    .where(inArray(channelMembers.channelId, channelIds));

  for (const row of rows) {
    const existing = grouped.get(row.channelId);
    if (existing) existing.push(row.userId);
    else grouped.set(row.channelId, [row.userId]);
  }

  return grouped;
}

/**
 * DM identity lives in the `name` column so the workspace unique index does
 * the deduplication, rather than a second table and a race to lose.
 */
function dmKey(participants: string[]): string {
  return `dm:${participants.join(':')}`;
}

export function isDmKey(name: string | null): boolean {
  return name !== null && name.startsWith('dm:');
}

export function toChannel(row: typeof channels.$inferSelect): Channel {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind,
    name: isDmKey(row.name) ? null : row.name,
    topic: row.topic,
    isPrivate: row.isPrivate,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  };
}

function emptySummary(channel: Channel): ChannelSummary {
  return {
    channel,
    lastSeq: 0,
    lastMessageAt: null,
    readSeq: 0,
    unreadCount: 0,
    mentionCount: 0,
    notificationLevel: 'all',
    muted: false,
    memberIds: [],
  };
}
