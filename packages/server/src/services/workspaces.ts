import {
  err,
  hashToken,
  ok,
  randomToken,
  ulid,
  type CreateInviteInput,
  type Result,
  type Role,
  type Workspace,
  type WorkspaceMembership,
} from '@huddle/core';
import { invites, memberships, workspaces } from '@huddle/db';
import { and, eq, sql } from 'drizzle-orm';
import { requireMember, type AccessError } from './access.js';
import type { AppContext } from '../context.js';

export type InviteError = 'invalid_invite' | 'expired' | 'used_up';

export async function createWorkspace(
  ctx: AppContext,
  input: { userId: string; name: string; slug: string },
): Promise<Result<WorkspaceMembership, 'slug_taken'>> {
  const now = ctx.now();
  const workspace: Workspace = {
    id: ulid(now),
    slug: input.slug,
    name: input.name,
    iconUrl: null,
    createdAt: now,
  };

  const created = await ctx.db
    .insert(workspaces)
    .values(workspace)
    .onConflictDoNothing()
    .returning();

  if (!created[0]) return err('slug_taken');

  await ctx.db
    .insert(memberships)
    .values({ workspaceId: workspace.id, userId: input.userId, role: 'owner', joinedAt: now });

  return ok({ workspace: created[0], role: 'owner' });
}

export async function listWorkspaces(
  ctx: AppContext,
  userId: string,
): Promise<WorkspaceMembership[]> {
  const rows = await ctx.db
    .select({ workspace: workspaces, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(workspaces.name);

  return rows;
}

export async function findWorkspaceBySlug(
  ctx: AppContext,
  input: { slug: string; userId: string },
): Promise<Result<WorkspaceMembership, AccessError | 'not_found'>> {
  const rows = await ctx.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, input.slug))
    .limit(1);
  const workspace = rows[0];
  if (!workspace) return err('not_found');

  const member = await requireMember(ctx.db, { workspaceId: workspace.id, userId: input.userId });
  if (!member.ok) return err(member.error);

  return ok({ workspace, role: member.value.role });
}

export async function createInvite(
  ctx: AppContext,
  input: { workspaceId: string; actorId: string } & CreateInviteInput,
): Promise<Result<{ token: string; expiresAt: number; role: Role }, AccessError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.actorId,
    minimumRole: 'admin',
  });
  if (!member.ok) return err(member.error);

  const now = ctx.now();
  const expiresAt = now + input.expiresInHours * 60 * 60 * 1000;
  const token = randomToken();

  await ctx.db.insert(invites).values({
    id: ulid(now),
    workspaceId: input.workspaceId,
    tokenHash: await hashToken(token),
    role: input.role,
    createdBy: input.actorId,
    createdAt: now,
    expiresAt,
    maxUses: input.maxUses,
    useCount: 0,
    revokedAt: null,
  });

  return ok({ token, expiresAt, role: input.role });
}

/** Powers the join screen, which shows what someone is about to join before they commit. */
export async function describeInvite(
  ctx: AppContext,
  token: string,
): Promise<Result<{ workspace: Workspace; role: Role }, InviteError>> {
  const usable = await loadUsableInvite(ctx, token);
  if (!usable.ok) return err(usable.error);

  const rows = await ctx.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, usable.value.workspaceId))
    .limit(1);

  const workspace = rows[0];
  if (!workspace) return err('invalid_invite');

  return ok({ workspace, role: usable.value.role });
}

export async function acceptInvite(
  ctx: AppContext,
  input: { token: string; userId: string },
): Promise<Result<WorkspaceMembership, InviteError>> {
  const usable = await loadUsableInvite(ctx, input.token);
  if (!usable.ok) return err(usable.error);

  const invite = usable.value;
  const rows = await ctx.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspaceId))
    .limit(1);

  const workspace = rows[0];
  if (!workspace) return err('invalid_invite');

  const existing = await requireMember(ctx.db, {
    workspaceId: invite.workspaceId,
    userId: input.userId,
  });

  // Opening the same link twice must not spend a second use, and must never
  // quietly demote someone who already holds a higher role.
  if (existing.ok) return ok({ workspace, role: existing.value.role });

  await ctx.db.insert(memberships).values({
    workspaceId: invite.workspaceId,
    userId: input.userId,
    role: invite.role,
    joinedAt: ctx.now(),
  });

  await ctx.db
    .update(invites)
    .set({ useCount: sql`${invites.useCount} + 1` })
    .where(eq(invites.id, invite.id));

  return ok({ workspace, role: invite.role });
}

export async function revokeInvite(
  ctx: AppContext,
  input: { inviteId: string; workspaceId: string; actorId: string },
): Promise<Result<null, AccessError | 'not_found'>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.actorId,
    minimumRole: 'admin',
  });
  if (!member.ok) return err(member.error);

  const revoked = await ctx.db
    .update(invites)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(invites.id, input.inviteId), eq(invites.workspaceId, input.workspaceId)))
    .returning({ id: invites.id });

  if (!revoked[0]) return err('not_found');
  return ok(null);
}

async function loadUsableInvite(
  ctx: AppContext,
  token: string,
): Promise<Result<{ id: string; workspaceId: string; role: Role }, InviteError>> {
  const rows = await ctx.db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, await hashToken(token)))
    .limit(1);

  const invite = rows[0];
  if (!invite || invite.revokedAt !== null) return err('invalid_invite');
  if (invite.expiresAt <= ctx.now()) return err('expired');
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return err('used_up');

  return ok({ id: invite.id, workspaceId: invite.workspaceId, role: invite.role });
}
