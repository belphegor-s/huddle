import { ulid, type Role } from '@huddle/core';
import { memberships, users } from '@huddle/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../app.js';
import { createTestApp } from '../testing/index.js';
import { createChannel, createWorkspace, joinChannel } from './index.js';
import { listMembers, removeMember, setMemberRole } from './members.js';

let app: App;

beforeEach(async () => {
  app = await createTestApp();
});

afterEach(async () => {
  await app.close();
});

async function person(name: string): Promise<string> {
  const now = app.ctx.now();
  const id = ulid(now);

  await app.ctx.db.insert(users).values({
    id,
    email: `${name}@example.com`,
    displayName: name,
    avatarUrl: null,
    timezone: null,
    createdAt: now,
  });

  return id;
}

/** Builds a workspace whose people already hold the roles a test cares about. */
async function workspaceWith(roles: Record<string, Role>) {
  const names = Object.keys(roles);
  const ids: Record<string, string> = {};
  for (const name of names) ids[name] = await person(name);

  const owner = names.find((name) => roles[name] === 'owner');
  if (owner === undefined) throw new Error('Every workspace needs an owner');

  const created = await createWorkspace(app.ctx, {
    userId: ids[owner] ?? '',
    name: 'Acme',
    slug: 'acme',
  });
  if (!created.ok) throw new Error('workspace');
  const workspaceId = created.value.workspace.id;

  for (const name of names) {
    if (name === owner) continue;
    await app.ctx.db.insert(memberships).values({
      workspaceId,
      userId: ids[name] ?? '',
      role: roles[name] ?? 'member',
      joinedAt: app.ctx.now(),
    });
  }

  return { workspaceId, ids };
}

async function roleOf(workspaceId: string, userId: string): Promise<string | undefined> {
  const rows = await app.ctx.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));

  return rows[0]?.role;
}

describe('listing members', () => {
  it('shows everyone with their role', async () => {
    const { workspaceId, ids } = await workspaceWith({ ada: 'owner', sam: 'member' });

    const listed = await listMembers(app.ctx, { workspaceId, userId: ids.sam ?? '' });
    if (!listed.ok) throw new Error(listed.error);

    expect(listed.value.map((member) => [member.displayName, member.role])).toEqual([
      ['ada', 'owner'],
      ['sam', 'member'],
    ]);
  });

  it('refuses someone outside the workspace', async () => {
    const { workspaceId } = await workspaceWith({ ada: 'owner' });
    const stranger = await person('mallory');

    expect((await listMembers(app.ctx, { workspaceId, userId: stranger })).ok).toBe(false);
  });
});

describe('changing a role', () => {
  it('lets an owner promote a member to admin', async () => {
    const { workspaceId, ids } = await workspaceWith({ ada: 'owner', sam: 'member' });

    const changed = await setMemberRole(app.ctx, {
      workspaceId,
      actorId: ids.ada ?? '',
      userId: ids.sam ?? '',
      role: 'admin',
    });

    expect(changed.ok).toBe(true);
    expect(await roleOf(workspaceId, ids.sam ?? '')).toBe('admin');
  });

  it('refuses a member who is not an admin', async () => {
    const { workspaceId, ids } = await workspaceWith({
      ada: 'owner',
      sam: 'member',
      kit: 'member',
    });

    expect(
      await setMemberRole(app.ctx, {
        workspaceId,
        actorId: ids.sam ?? '',
        userId: ids.kit ?? '',
        role: 'admin',
      }),
    ).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it('stops an admin promoting anyone to owner', async () => {
    const { workspaceId, ids } = await workspaceWith({
      ada: 'owner',
      sam: 'admin',
      kit: 'member',
    });

    expect(
      await setMemberRole(app.ctx, {
        workspaceId,
        actorId: ids.sam ?? '',
        userId: ids.kit ?? '',
        role: 'owner',
      }),
    ).toMatchObject({ ok: false, error: 'outranked' });
  });

  it('stops an admin demoting an owner', async () => {
    const { workspaceId, ids } = await workspaceWith({ ada: 'owner', sam: 'admin' });

    expect(
      await setMemberRole(app.ctx, {
        workspaceId,
        actorId: ids.sam ?? '',
        userId: ids.ada ?? '',
        role: 'member',
      }),
    ).toMatchObject({ ok: false, error: 'outranked' });
  });

  it('stops anyone changing their own role', async () => {
    const { workspaceId, ids } = await workspaceWith({ ada: 'owner', sam: 'admin' });

    expect(
      await setMemberRole(app.ctx, {
        workspaceId,
        actorId: ids.sam ?? '',
        userId: ids.sam ?? '',
        role: 'owner',
      }),
    ).toMatchObject({ ok: false, error: 'cannot_change_own_role' });
  });

  it('lets an owner hand the workspace to someone else', async () => {
    const { workspaceId, ids } = await workspaceWith({ ada: 'owner', sam: 'admin' });

    const promoted = await setMemberRole(app.ctx, {
      workspaceId,
      actorId: ids.ada ?? '',
      userId: ids.sam ?? '',
      role: 'owner',
    });
    expect(promoted.ok).toBe(true);

    // Two owners now, so the first one stepping down is allowed.
    const stepped = await setMemberRole(app.ctx, {
      workspaceId,
      actorId: ids.sam ?? '',
      userId: ids.ada ?? '',
      role: 'admin',
    });

    expect(stepped.ok).toBe(true);
    expect(await roleOf(workspaceId, ids.ada ?? '')).toBe('admin');
  });
});

describe('removing a member', () => {
  it('takes their channel memberships with them', async () => {
    const { workspaceId, ids } = await workspaceWith({ ada: 'owner', sam: 'member' });

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ids.ada ?? '',
      name: 'general',
      topic: null,
      isPrivate: false,
    });
    if (!channel.ok) throw new Error('channel');

    await joinChannel(app.ctx, { channelId: channel.value.channel.id, userId: ids.sam ?? '' });

    expect(
      (
        await removeMember(app.ctx, {
          workspaceId,
          actorId: ids.ada ?? '',
          userId: ids.sam ?? '',
        })
      ).ok,
    ).toBe(true);

    expect(await roleOf(workspaceId, ids.sam ?? '')).toBeUndefined();

    // The channel is unreachable from their side too, so nothing is delivered.
    expect(
      await joinChannel(app.ctx, {
        channelId: channel.value.channel.id,
        userId: ids.sam ?? '',
      }),
    ).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('lets someone leave on their own', async () => {
    const { workspaceId, ids } = await workspaceWith({ ada: 'owner', sam: 'member' });

    expect(
      (
        await removeMember(app.ctx, {
          workspaceId,
          actorId: ids.sam ?? '',
          userId: ids.sam ?? '',
        })
      ).ok,
    ).toBe(true);

    expect(await roleOf(workspaceId, ids.sam ?? '')).toBeUndefined();
  });

  it('refuses a member removing anyone else', async () => {
    const { workspaceId, ids } = await workspaceWith({
      ada: 'owner',
      sam: 'member',
      kit: 'member',
    });

    expect(
      await removeMember(app.ctx, {
        workspaceId,
        actorId: ids.sam ?? '',
        userId: ids.kit ?? '',
      }),
    ).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it('refuses to let the last owner walk out', async () => {
    const { workspaceId, ids } = await workspaceWith({ ada: 'owner', sam: 'admin' });

    expect(
      await removeMember(app.ctx, {
        workspaceId,
        actorId: ids.ada ?? '',
        userId: ids.ada ?? '',
      }),
    ).toMatchObject({ ok: false, error: 'last_owner' });
  });
});
