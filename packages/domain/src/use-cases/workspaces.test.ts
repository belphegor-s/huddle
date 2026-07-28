import { ulid, type User } from '@huddle/core';
import { users } from '@huddle/db';
import { describe, expect, it } from 'vitest';
import { requireMember } from '../access.js';
import { createTestPorts, type TestPorts } from '../testing/index.js';
import {
  acceptInvite,
  createInvite,
  createWorkspace,
  describeInvite,
  findWorkspaceBySlug,
  listWorkspaces,
  revokeInvite,
} from './workspaces.js';

async function person(ports: TestPorts, name: string): Promise<User> {
  const user: User = {
    id: ulid(ports.clock.now()),
    email: `${name}@example.com`,
    displayName: name,
    avatarUrl: null,
    timezone: null,
    createdAt: ports.clock.now(),
  };
  await ports.db.insert(users).values(user);
  return user;
}

async function acmeOwnedBy(ports: TestPorts, owner: User) {
  const created = await createWorkspace(ports, { userId: owner.id, name: 'Acme', slug: 'acme' });
  if (!created.ok) throw new Error(created.error);
  return created.value.workspace;
}

async function inviteFrom(
  ports: TestPorts,
  input: { workspaceId: string; actorId: string; role?: 'admin' | 'member' | 'guest' },
) {
  const invite = await createInvite(ports, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    role: input.role ?? 'member',
    expiresInHours: 168,
    maxUses: null,
  });
  if (!invite.ok) throw new Error(invite.error);
  return invite.value;
}

describe('creating a workspace', () => {
  it('makes the creator its owner', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');

    const created = await createWorkspace(ports, { userId: ada.id, name: 'Acme', slug: 'acme' });

    expect(created.ok && created.value.role).toBe('owner');
    expect(await listWorkspaces(ports, ada.id)).toHaveLength(1);
  });

  it('refuses a slug already in use', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    await acmeOwnedBy(ports, ada);

    const clash = await createWorkspace(ports, { userId: sam.id, name: 'Acme Two', slug: 'acme' });

    expect(clash).toEqual({ ok: false, error: 'slug_taken' });
    expect(await listWorkspaces(ports, sam.id)).toHaveLength(0);
  });

  it('is invisible to people who are not in it', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    await acmeOwnedBy(ports, ada);

    expect(await findWorkspaceBySlug(ports, { slug: 'acme', userId: sam.id })).toEqual({
      ok: false,
      error: 'not_a_member',
    });
  });
});

describe('invites', () => {
  it('lets an owner invite and a stranger join', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    const acme = await acmeOwnedBy(ports, ada);

    const invite = await inviteFrom(ports, { workspaceId: acme.id, actorId: ada.id });
    const joined = await acceptInvite(ports, { token: invite.token, userId: sam.id });

    expect(joined.ok && joined.value.role).toBe('member');
    expect(await listWorkspaces(ports, sam.id)).toHaveLength(1);
  });

  it('describes the workspace before anyone commits to joining', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const acme = await acmeOwnedBy(ports, ada);
    const invite = await inviteFrom(ports, { workspaceId: acme.id, actorId: ada.id });

    const described = await describeInvite(ports, invite.token);

    expect(described.ok && described.value.workspace.name).toBe('Acme');
  });

  it('refuses to issue one for an ordinary member', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    const acme = await acmeOwnedBy(ports, ada);

    const invite = await inviteFrom(ports, { workspaceId: acme.id, actorId: ada.id });
    await acceptInvite(ports, { token: invite.token, userId: sam.id });

    expect(
      await createInvite(ports, {
        workspaceId: acme.id,
        actorId: sam.id,
        role: 'member',
        expiresInHours: 24,
        maxUses: null,
      }),
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('refuses to issue one for someone outside the workspace', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const stranger = await person(ports, 'mallory');
    const acme = await acmeOwnedBy(ports, ada);

    expect(
      await createInvite(ports, {
        workspaceId: acme.id,
        actorId: stranger.id,
        role: 'admin',
        expiresInHours: 24,
        maxUses: null,
      }),
    ).toEqual({ ok: false, error: 'not_a_member' });
  });

  it('keeps the existing role when the same link is opened twice', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    const acme = await acmeOwnedBy(ports, ada);

    const adminInvite = await inviteFrom(ports, {
      workspaceId: acme.id,
      actorId: ada.id,
      role: 'admin',
    });
    await acceptInvite(ports, { token: adminInvite.token, userId: sam.id });

    const guestInvite = await inviteFrom(ports, {
      workspaceId: acme.id,
      actorId: ada.id,
      role: 'guest',
    });
    const again = await acceptInvite(ports, { token: guestInvite.token, userId: sam.id });

    expect(again.ok && again.value.role).toBe('admin');
  });

  it('runs out when it hits its use limit', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    const kim = await person(ports, 'kim');
    const acme = await acmeOwnedBy(ports, ada);

    const invite = await createInvite(ports, {
      workspaceId: acme.id,
      actorId: ada.id,
      role: 'member',
      expiresInHours: 24,
      maxUses: 1,
    });
    if (!invite.ok) throw new Error(invite.error);

    expect((await acceptInvite(ports, { token: invite.value.token, userId: sam.id })).ok).toBe(
      true,
    );
    expect(await acceptInvite(ports, { token: invite.value.token, userId: kim.id })).toEqual({
      ok: false,
      error: 'used_up',
    });
  });

  it('expires', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    const acme = await acmeOwnedBy(ports, ada);

    const invite = await createInvite(ports, {
      workspaceId: acme.id,
      actorId: ada.id,
      role: 'member',
      expiresInHours: 1,
      maxUses: null,
    });
    if (!invite.ok) throw new Error(invite.error);

    ports.clock.advance(2 * 60 * 60 * 1000);

    expect(await acceptInvite(ports, { token: invite.value.token, userId: sam.id })).toEqual({
      ok: false,
      error: 'expired',
    });
  });

  it('stops working once revoked', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    const acme = await acmeOwnedBy(ports, ada);
    const invite = await inviteFrom(ports, { workspaceId: acme.id, actorId: ada.id });

    const described = await describeInvite(ports, invite.token);
    if (!described.ok) throw new Error(described.error);

    const invited = await ports.db.query.invites.findFirst();
    if (!invited) throw new Error('Invite row missing');

    expect(
      await revokeInvite(ports, { inviteId: invited.id, workspaceId: acme.id, actorId: ada.id }),
    ).toEqual({ ok: true, value: null });

    expect(await acceptInvite(ports, { token: invite.token, userId: sam.id })).toEqual({
      ok: false,
      error: 'invalid_invite',
    });
  });

  it('rejects a token nobody issued', async () => {
    const ports = await createTestPorts();
    const sam = await person(ports, 'sam');

    expect(await acceptInvite(ports, { token: 'made-up', userId: sam.id })).toEqual({
      ok: false,
      error: 'invalid_invite',
    });
  });
});

describe('the membership guard', () => {
  it('does not carry membership across workspaces', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const sam = await person(ports, 'sam');
    const acme = await acmeOwnedBy(ports, ada);

    const other = await createWorkspace(ports, { userId: sam.id, name: 'Other', slug: 'other' });
    if (!other.ok) throw new Error(other.error);

    expect(await requireMember(ports.db, { workspaceId: acme.id, userId: sam.id })).toEqual({
      ok: false,
      error: 'not_a_member',
    });
  });

  it('ranks roles so an owner clears an admin bar', async () => {
    const ports = await createTestPorts();
    const ada = await person(ports, 'ada');
    const acme = await acmeOwnedBy(ports, ada);

    const allowed = await requireMember(ports.db, {
      workspaceId: acme.id,
      userId: ada.id,
      minimumRole: 'admin',
    });

    expect(allowed.ok && allowed.value.role).toBe('owner');
  });
});
