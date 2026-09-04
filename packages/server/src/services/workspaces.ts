import {
  err,
  ok,
  randomToken,
  ulid,
  type CreateInviteInput,
  type InviteSummary,
  type Result,
  type Role,
  type UpdateWorkspaceInput,
  type Workspace,
  type WorkspaceMembership,
} from '@huddle/core';
import { invites, memberships, workspaces } from '@huddle/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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
    token,
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

/**
 * Live invitations, so an admin can see what is outstanding and cut one off.
 * The link itself is absent by design: it was only ever available once.
 */
export async function listInvites(
  ctx: AppContext,
  input: { workspaceId: string; actorId: string },
): Promise<Result<InviteSummary[], AccessError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.actorId,
    minimumRole: 'admin',
  });
  if (!member.ok) return err(member.error);

  const now = ctx.now();
  const rows = await ctx.db
    .select()
    .from(invites)
    .where(and(eq(invites.workspaceId, input.workspaceId), isNull(invites.revokedAt)))
    .orderBy(desc(invites.createdAt));

  return ok(
    rows.map((row) => ({
      id: row.id,
      role: row.role,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      token: row.token,
      maxUses: row.maxUses,
      useCount: row.useCount,
      expired: row.expiresAt <= now || (row.maxUses !== null && row.useCount >= row.maxUses),
    })),
  );
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
  const rows = await ctx.db.select().from(invites).where(eq(invites.token, token)).limit(1);

  const invite = rows[0];
  if (!invite || invite.revokedAt !== null) return err('invalid_invite');
  if (invite.expiresAt <= ctx.now()) return err('expired');
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return err('used_up');

  return ok({ id: invite.id, workspaceId: invite.workspaceId, role: invite.role });
}

/**
 * Renaming and reskinning, for an admin. The slug is not editable: every link
 * anybody has already shared carries it.
 */
export async function updateWorkspace(
  ctx: AppContext,
  input: { workspaceId: string; userId: string } & UpdateWorkspaceInput,
): Promise<Result<Workspace, AccessError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    minimumRole: 'admin',
  });
  if (!member.ok) return err(member.error);

  const patch: Partial<{ name: string; iconUrl: string | null }> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.iconUrl !== undefined) patch.iconUrl = input.iconUrl;

  if (Object.keys(patch).length === 0) {
    const current = await ctx.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);

    const found = current[0];
    if (!found) return err('not_a_member');
    return ok(found);
  }

  const updated = await ctx.db
    .update(workspaces)
    .set(patch)
    .where(eq(workspaces.id, input.workspaceId))
    .returning();

  const row = updated[0];
  if (!row) return err('not_a_member');
  return ok(row);
}
