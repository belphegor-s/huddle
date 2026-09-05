import {
  createChannelKey,
  createDeviceKeys,
  openChannelKey,
  publishDevice,
  sealChannelKey,
  ulid,
  type DeviceKeys,
  type DevicePublicBundle,
} from '@huddle/core';
import { channelMembers, memberships, users } from '@huddle/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../app.js';
import { createTestApp } from '../testing/index.js';
import {
  channelDevices,
  devicesAwaitingKeys,
  fetchChannelKeys,
  publishChannelKeys,
  registerDevice,
  rotateChannelKey,
} from './keys.js';
import {
  createChannel,
  createWorkspace,
  leaveChannel,
  openDm,
  searchMessages,
  sendMessage,
} from './index.js';

/**
 * Added rather than joined: a private channel refuses a self join, which is
 * the whole point of it being private.
 */
async function addToChannel(channelId: string, userId: string): Promise<void> {
  await app.ctx.db
    .insert(channelMembers)
    .values({ channelId, userId, joinedAt: app.ctx.now() })
    .onConflictDoNothing();
}

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

/** Somebody with a browser: an account, a workspace seat, and device keys. */
async function member(workspaceId: string | null, name: string) {
  const userId = await person(name);
  if (workspaceId !== null) {
    await app.ctx.db.insert(memberships).values({
      workspaceId,
      userId,
      role: 'member',
      joinedAt: app.ctx.now(),
    });
  }

  const keys: DeviceKeys = await createDeviceKeys();
  const bundle: DevicePublicBundle = await publishDevice(keys);
  const device = await registerDevice(app.ctx, {
    userId,
    encryptionKey: bundle.encryptionKey,
    signingKey: bundle.signingKey,
    label: name,
  });

  return { userId, keys, bundle, device };
}

async function workspace(ownerId: string) {
  const created = await createWorkspace(app.ctx, { userId: ownerId, name: 'Acme', slug: 'acme' });
  if (!created.ok) throw new Error('workspace');
  return created.value.workspace.id;
}

describe('devices', () => {
  it('treats the same keys arriving again as the same device', async () => {
    // Otherwise every sign in scatters a duplicate that all future channel
    // keys then have to be sealed to.
    const userId = await person('ada');
    const bundle = await publishDevice(await createDeviceKeys());

    const first = await registerDevice(app.ctx, { userId, ...bundle, label: 'laptop' });
    const again = await registerDevice(app.ctx, { userId, ...bundle, label: 'laptop' });

    expect(again.id).toBe(first.id);
  });

  it('lists every device of every member, so a key can reach all of them', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const grace = await member(workspaceId, 'grace');

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'general',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');
    await addToChannel(channel.value.channel.id, grace.userId);

    const listed = await channelDevices(app.ctx, {
      channelId: channel.value.channel.id,
      userId: ada.userId,
    });

    expect(listed.ok && listed.value.map((one) => one.id).sort()).toEqual(
      [ada.device.id, grace.device.id].sort(),
    );
  });
});

describe('who may hold a key', () => {
  it('offers a public channel key to everyone in the workspace', async () => {
    // A public channel is readable by anybody here, who can join with one
    // click and be handed the key anyway. Withholding it from somebody
    // reading the channel buys nothing and leaves them staring at nothing.
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const grace = await member(workspaceId, 'grace');

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'general',
      topic: null,
      isPrivate: false,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');

    const waiting = await devicesAwaitingKeys(app.ctx, {
      channelId: channel.value.channel.id,
      userId: ada.userId,
    });

    // Grace has never joined the channel.
    expect(waiting.ok && waiting.value.devices.map((one) => one.id)).toContain(grace.device.id);
  });

  it('keeps a private channel key to the people actually in it', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const grace = await member(workspaceId, 'grace');

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'secret',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');

    const waiting = await devicesAwaitingKeys(app.ctx, {
      channelId: channel.value.channel.id,
      userId: ada.userId,
    });

    expect(waiting.ok && waiting.value.devices.map((one) => one.id)).not.toContain(grace.device.id);
  });
});

describe('channel keys', () => {
  it('carries a key from one person to another without the server reading it', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const grace = await member(workspaceId, 'grace');

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'secret',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');
    const channelId = channel.value.channel.id;
    await addToChannel(channelId, grace.userId);

    const key = await createChannelKey();
    const sealed = await sealChannelKey(key, grace.bundle, ada.keys);

    const published = await publishChannelKeys(app.ctx, {
      channelId,
      userId: ada.userId,
      epoch: 0,
      sealedBy: ada.device.id,
      entries: [{ deviceId: grace.device.id, sealed: JSON.stringify(sealed) }],
    });
    expect(published.ok).toBe(true);

    const fetched = await fetchChannelKeys(app.ctx, {
      channelId,
      userId: grace.userId,
      deviceId: grace.device.id,
    });
    if (!fetched.ok) throw new Error('fetch');

    const record = fetched.value[0];
    expect(record).toBeDefined();

    // The proof: what the server handed over opens with Grace's private key.
    const opened = await openChannelKey(JSON.parse(record?.sealed ?? '{}'), grace.keys, ada.bundle);
    expect(opened).toBeDefined();
  });

  it('refuses to hand a sealed key to a device that is not yours', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const grace = await member(workspaceId, 'grace');

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'secret',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');
    await addToChannel(channel.value.channel.id, grace.userId);

    const stolen = await fetchChannelKeys(app.ctx, {
      channelId: channel.value.channel.id,
      userId: ada.userId,
      deviceId: grace.device.id,
    });

    expect(stolen.ok === false && stolen.error).toBe('unknown_device');
  });

  it('refuses to seal for a device outside the channel', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const outsider = await member(workspaceId, 'mallory');

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'secret',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');

    const published = await publishChannelKeys(app.ctx, {
      channelId: channel.value.channel.id,
      userId: ada.userId,
      epoch: 0,
      sealedBy: ada.device.id,
      entries: [{ deviceId: outsider.device.id, sealed: '{}' }],
    });

    expect(published.ok === false && published.error).toBe('forbidden');
  });

  it('names the devices still waiting for a key', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const grace = await member(workspaceId, 'grace');

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'secret',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');
    const channelId = channel.value.channel.id;
    await addToChannel(channelId, grace.userId);

    await publishChannelKeys(app.ctx, {
      channelId,
      userId: ada.userId,
      epoch: 0,
      sealedBy: ada.device.id,
      entries: [{ deviceId: ada.device.id, sealed: '{}' }],
    });

    const waiting = await devicesAwaitingKeys(app.ctx, { channelId, userId: ada.userId });
    expect(waiting.ok && waiting.value.devices.map((one) => one.id)).toEqual([grace.device.id]);
  });

  it('moves to a new key when somebody leaves', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const grace = await member(workspaceId, 'grace');

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'secret',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');
    const channelId = channel.value.channel.id;
    await addToChannel(channelId, grace.userId);

    await leaveChannel(app.ctx, { channelId, userId: grace.userId });

    const after = await devicesAwaitingKeys(app.ctx, { channelId, userId: ada.userId });
    expect(after.ok && after.value.epoch).toBe(1);

    // And the key they were holding is no longer served to them.
    const theirs = await fetchChannelKeys(app.ctx, {
      channelId,
      userId: grace.userId,
      deviceId: grace.device.id,
    });
    expect(theirs.ok).toBe(false);
  });

  it('refuses to seal for an epoch the channel has already left', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'secret',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');
    const channelId = channel.value.channel.id;

    await rotateChannelKey(app.ctx, { channelId, userId: ada.userId });

    const stale = await publishChannelKeys(app.ctx, {
      channelId,
      userId: ada.userId,
      epoch: 0,
      sealedBy: ada.device.id,
      entries: [{ deviceId: ada.device.id, sealed: '{}' }],
    });

    expect(stale.ok === false && stale.error).toBe('stale_epoch');
  });
});

describe('encrypted channels', () => {
  async function secretChannel() {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);

    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'secret',
      topic: null,
      isPrivate: true,
      encrypted: true,
    });
    if (!channel.ok) throw new Error('channel');

    return { ada, workspaceId, channelId: channel.value.channel.id };
  }

  it('refuses a plaintext message', async () => {
    // The important one. A client that lost its key has to fail loudly rather
    // than quietly post something readable into a private conversation.
    const { ada, channelId } = await secretChannel();

    const sent = await sendMessage(app.ctx, {
      channelId,
      userId: ada.userId,
      draft: {
        id: ulid(app.ctx.now()),
        body: JSON.stringify({ type: 'doc' }),
        text: 'in the clear',
        parentId: null,
        attachments: [],
        mentions: [],
        epoch: null,
      },
    });

    expect(sent.ok === false && sent.error).toBe('encryption_mismatch');
  });

  it('refuses ciphertext in a channel that is not encrypted', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const channel = await createChannel(app.ctx, {
      workspaceId,
      userId: ada.userId,
      name: 'open',
      topic: null,
      isPrivate: false,
      encrypted: false,
    });
    if (!channel.ok) throw new Error('channel');

    const sent = await sendMessage(app.ctx, {
      channelId: channel.value.channel.id,
      userId: ada.userId,
      draft: {
        id: ulid(app.ctx.now()),
        body: 'ciphertext',
        text: '',
        parentId: null,
        attachments: [],
        mentions: [],
        epoch: 0,
      },
    });

    expect(sent.ok === false && sent.error).toBe('encryption_mismatch');
  });

  it('refuses a message sealed under an old key', async () => {
    const { ada, channelId } = await secretChannel();
    await rotateChannelKey(app.ctx, { channelId, userId: ada.userId });

    const sent = await sendMessage(app.ctx, {
      channelId,
      userId: ada.userId,
      draft: {
        id: ulid(app.ctx.now()),
        body: 'ciphertext',
        text: '',
        parentId: null,
        attachments: [],
        mentions: [],
        epoch: 0,
      },
    });

    expect(sent.ok === false && sent.error).toBe('stale_epoch');
  });

  it('keeps no searchable text, even when a client sends some', async () => {
    const { ada, workspaceId, channelId } = await secretChannel();

    const sent = await sendMessage(app.ctx, {
      channelId,
      userId: ada.userId,
      draft: {
        id: ulid(app.ctx.now()),
        body: 'ciphertext',
        // A client that also sent the plaintext must not have it stored.
        text: 'the merger closes on Friday',
        parentId: null,
        attachments: [],
        mentions: [],
        epoch: 0,
      },
    });
    expect(sent.ok).toBe(true);
    expect(sent.ok && sent.value.text).toBe('');

    const found = await searchMessages(app.ctx, {
      workspaceId,
      userId: ada.userId,
      query: { text: 'merger', limit: 20 },
    });

    expect(found.ok && found.value).toHaveLength(0);
  });

  it('opens a direct conversation encrypted, without anybody asking', async () => {
    const ada = await member(null, 'ada');
    const workspaceId = await workspace(ada.userId);
    const grace = await member(workspaceId, 'grace');

    const dm = await openDm(app.ctx, {
      workspaceId,
      userId: ada.userId,
      userIds: [grace.userId],
    });

    expect(dm.ok && dm.value.channel.encrypted).toBe(true);
  });
});
