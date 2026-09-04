import { err, ok, type MemberProfile, type Presence, type Result, type Role } from '@huddle/core';

/**
 * A socket refreshes its user's timestamp on connect and on every ping, and
 * pings run every 25 seconds, so this is comfortably more than one missed
 * beat and comfortably less than a stale row looking present.
 */
const ONLINE_WINDOW_MS = 70_000;
import { channelMembers, channels, memberships, users } from '@huddle/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { outranks, requireMember, type AccessError } from './access.js';

export type MemberError =
  AccessError | 'not_found' | 'last_owner' | 'outranked' | 'cannot_change_own_role';

export async function listMembers(
  ctx: AppContext,
  input: { workspaceId: string; userId: string },
): Promise<Result<MemberProfile[], AccessError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err(member.error);

  const rows = await ctx.db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: memberships.role,
      presence: users.presence,
      statusEmoji: users.statusEmoji,
      statusText: users.statusText,
      lastSeenAt: users.lastSeenAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, input.workspaceId))
    .orderBy(asc(users.displayName));

  const now = ctx.now();
  return ok(
    rows.map(({ lastSeenAt, ...row }) => ({
      ...row,
      online: isOnline(row.presence, lastSeenAt, now),
    })),
  );
}

/**
 * Nobody may hand out a role at or above their own, and nobody may change
 * their own. Both rules exist for the same reason: without them an admin can
 * promote themselves to owner, and the owner's authority is decorative.
 */
export async function setMemberRole(
  ctx: AppContext,
  input: { workspaceId: string; actorId: string; userId: string; role: Role },
): Promise<Result<MemberProfile, MemberError>> {
  const actor = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.actorId,
    minimumRole: 'admin',
  });
  if (!actor.ok) return err(actor.error);
  if (input.actorId === input.userId) return err('cannot_change_own_role');

  const target = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!target.ok) return err('not_found');

  // An admin cannot touch an owner, and cannot mint one.
  if (!outranks(actor.value.role, target.value.role)) return err('outranked');
  if (!outranks(actor.value.role, input.role)) return err('outranked');

  if (target.value.role === 'owner' && (await countOwners(ctx, input.workspaceId)) === 1) {
    return err('last_owner');
  }

  const updated = await ctx.db
    .update(memberships)
    .set({ role: input.role })
    .where(
      and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId)),
    )
    .returning({ userId: memberships.userId, role: memberships.role });

  const row = updated[0];
  if (!row) return err('not_found');

  return ok(await profileOf(ctx, row.userId, row.role));
}

/**
 * Removing someone takes their channel memberships with it, so they stop
 * receiving realtime traffic and notifications immediately. Their messages
 * stay: a conversation with holes in it is not a record of anything.
 */
export async function removeMember(
  ctx: AppContext,
  input: { workspaceId: string; actorId: string; userId: string },
): Promise<Result<null, MemberError>> {
  const leaving = input.actorId === input.userId;

  const actor = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.actorId,
    ...(leaving ? {} : { minimumRole: 'admin' }),
  });
  if (!actor.ok) return err(actor.error);

  const target = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!target.ok) return err('not_found');

  if (!leaving && !outranks(actor.value.role, target.value.role)) return err('outranked');

  // The last owner cannot go, by removal or by walking out, or the workspace
  // is left with nobody who can administer it.
  if (target.value.role === 'owner' && (await countOwners(ctx, input.workspaceId)) === 1) {
    return err('last_owner');
  }

  const inWorkspace = ctx.db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.workspaceId, input.workspaceId));

  await ctx.db
    .delete(channelMembers)
    .where(
      and(eq(channelMembers.userId, input.userId), inArray(channelMembers.channelId, inWorkspace)),
    );

  await ctx.db
    .delete(memberships)
    .where(
      and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId)),
    );

  return ok(null);
}

async function countOwners(ctx: AppContext, workspaceId: string): Promise<number> {
  const owners = await ctx.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, 'owner')));

  return owners.length;
}

async function profileOf(ctx: AppContext, userId: string, role: Role): Promise<MemberProfile> {
  const rows = await ctx.db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      presence: users.presence,
      statusEmoji: users.statusEmoji,
      statusText: users.statusText,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user) throw new Error('Member vanished between update and read');

  const { lastSeenAt, ...profile } = user;
  return { ...profile, role, online: isOnline(user.presence, lastSeenAt, ctx.now()) };
}

/**
 * Connected recently, and not hiding. Derived from a timestamp rather than
 * from the hub's memory so that several instances agree on the answer and a
 * restart does not declare everybody offline.
 */
export function isOnline(presence: Presence, lastSeenAt: number | null, now: number): boolean {
  if (presence === 'invisible' || lastSeenAt === null) return false;
  return now - lastSeenAt < ONLINE_WINDOW_MS;
}
