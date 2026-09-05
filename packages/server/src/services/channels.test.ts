import { ulid, type Attachment } from '@huddle/core';
import { files, memberships, messages, users } from '@huddle/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../app.js';
import { createTestApp } from '../testing/index.js';
import {
  createChannel,
  createWorkspace,
  deleteChannel,
  findChannelByRef,
  joinChannel,
  listArchivedChannels,
  listChannels,
  sendMessage,
  updateChannel,
} from './index.js';

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

async function workspace(ownerId: string): Promise<string> {
  const created = await createWorkspace(app.ctx, { userId: ownerId, name: 'Acme', slug: 'acme' });
  if (!created.ok) throw new Error('workspace');
  return created.value.workspace.id;
}

async function member(workspaceId: string, name: string): Promise<string> {
  const userId = await person(name);
  await app.ctx.db.insert(memberships).values({
    workspaceId,
    userId,
    role: 'member',
    joinedAt: app.ctx.now(),
  });

  return userId;
}

async function channel(
  workspaceId: string,
  userId: string,
  name: string,
  isPrivate = false,
): Promise<string> {
  const created = await createChannel(app.ctx, {
    workspaceId,
    userId,
    name,
    topic: null,
    isPrivate,
    encrypted: false,
  });

  if (!created.ok) throw new Error(`channel: ${created.error}`);
  return created.value.channel.id;
}

describe('archiving', () => {
  it('takes the channel out of the sidebar', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const channelId = await channel(workspaceId, ada, 'general');

    await updateChannel(app.ctx, { channelId, userId: ada, patch: { archived: true } });

    const list = await listChannels(app.ctx, { workspaceId, userId: ada });
    expect(list.ok && list.value).toEqual([]);
  });

  it('shows it in the archived list instead of nowhere', async () => {
    // Archiving used to remove a channel from every query there is, which made
    // it a delete with a reassuring word on the button.
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const channelId = await channel(workspaceId, ada, 'general');

    await updateChannel(app.ctx, { channelId, userId: ada, patch: { archived: true } });

    const archived = await listArchivedChannels(app.ctx, { workspaceId, userId: ada });
    expect(archived.ok && archived.value.map((one) => one.name)).toEqual(['general']);
  });

  it('keeps an archived private channel to the people who were in it', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const grace = await member(workspaceId, 'grace');
    const channelId = await channel(workspaceId, ada, 'secret', true);

    await updateChannel(app.ctx, { channelId, userId: ada, patch: { archived: true } });

    const theirs = await listArchivedChannels(app.ctx, { workspaceId, userId: grace });
    expect(theirs.ok && theirs.value).toEqual([]);
  });

  it('frees the name for a new channel', async () => {
    // The name used to be held for good by a channel nobody could see.
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const first = await channel(workspaceId, ada, 'launch');

    await updateChannel(app.ctx, { channelId: first, userId: ada, patch: { archived: true } });

    const second = await createChannel(app.ctx, {
      workspaceId,
      userId: ada,
      name: 'launch',
      topic: null,
      isPrivate: false,
      encrypted: false,
    });

    expect(second.ok).toBe(true);
    expect(second.ok && second.value.channel.id).not.toBe(first);
  });

  it('still refuses a name a live channel is using', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    await channel(workspaceId, ada, 'general');

    const again = await createChannel(app.ctx, {
      workspaceId,
      userId: ada,
      name: 'general',
      topic: null,
      isPrivate: false,
      encrypted: false,
    });

    expect(again.ok || again.error).toBe('name_taken');
  });

  it('sends the name to whichever channel is live', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const first = await channel(workspaceId, ada, 'launch');
    await updateChannel(app.ctx, { channelId: first, userId: ada, patch: { archived: true } });
    const second = await channel(workspaceId, ada, 'launch');

    const found = await findChannelByRef(app.ctx, { workspaceId, userId: ada, ref: 'launch' });
    expect(found.ok && found.value.channel.id).toBe(second);
  });

  it('refuses to restore into a name that has been taken since', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const first = await channel(workspaceId, ada, 'launch');
    await updateChannel(app.ctx, { channelId: first, userId: ada, patch: { archived: true } });
    await channel(workspaceId, ada, 'launch');

    const restored = await updateChannel(app.ctx, {
      channelId: first,
      userId: ada,
      patch: { archived: false },
    });

    expect(restored.ok || restored.error).toBe('name_taken');
  });

  it('restores a channel whose name is still free', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const channelId = await channel(workspaceId, ada, 'launch');
    await updateChannel(app.ctx, { channelId, userId: ada, patch: { archived: true } });

    const restored = await updateChannel(app.ctx, {
      channelId,
      userId: ada,
      patch: { archived: false },
    });

    expect(restored.ok && restored.value.archivedAt).toBeNull();

    const list = await listChannels(app.ctx, { workspaceId, userId: ada });
    expect(list.ok && list.value.map((one) => one.channel.name)).toEqual(['launch']);
  });
});

describe('deleting', () => {
  it('takes the messages with it', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const channelId = await channel(workspaceId, ada, 'general');

    await sendMessage(app.ctx, {
      channelId,
      userId: ada,
      draft: {
        id: ulid(),
        body: '{"type":"doc"}',
        text: 'anything',
        parentId: null,
        attachments: [],
        mentions: [],
        epoch: null,
      },
    });

    const removed = await deleteChannel(app.ctx, { channelId, userId: ada });
    expect(removed.ok).toBe(true);

    const left = await app.ctx.db.select().from(messages).where(eq(messages.channelId, channelId));
    expect(left).toEqual([]);
  });

  it('takes the attachments out of the bucket as well', async () => {
    /*
     * A file row is workspace scoped, so nothing else would ever remove it.
     * Left behind, the bytes stay downloadable by anybody who knows the id,
     * which is not what deleting a conversation is supposed to mean.
     */
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const channelId = await channel(workspaceId, ada, 'general');

    const fileId = ulid();
    const storageKey = `${workspaceId}/${fileId}`;
    await app.ctx.blobs.put(storageKey, new Uint8Array([1, 2, 3]), 'image/png');
    await app.ctx.db.insert(files).values({
      id: fileId,
      workspaceId,
      uploaderId: ada,
      storageKey,
      name: 'plan.png',
      mimeType: 'image/png',
      size: 3,
      width: null,
      height: null,
      durationMs: null,
      peaks: null,
      createdAt: app.ctx.now(),
    });

    const attachment: Attachment = {
      id: fileId,
      kind: 'image',
      name: 'plan.png',
      mimeType: 'image/png',
      size: 3,
      url: `/api/files/${fileId}`,
      width: null,
      height: null,
      durationMs: null,
      peaks: null,
    };

    await sendMessage(app.ctx, {
      channelId,
      userId: ada,
      draft: {
        id: ulid(),
        body: '{"type":"doc"}',
        text: 'here it is',
        parentId: null,
        attachments: [attachment],
        mentions: [],
        epoch: null,
      },
    });

    await deleteChannel(app.ctx, { channelId, userId: ada });

    expect(await app.ctx.blobs.head(storageKey)).toBeNull();
    expect(await app.ctx.db.select().from(files).where(eq(files.id, fileId))).toEqual([]);
  });

  it('is not something an ordinary member can do to somebody else', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const grace = await member(workspaceId, 'grace');
    const channelId = await channel(workspaceId, ada, 'general');
    await joinChannel(app.ctx, { channelId, userId: grace });

    const removed = await deleteChannel(app.ctx, { channelId, userId: grace });
    expect(removed.ok || removed.error).toBe('forbidden');
  });

  it('frees the name too', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const channelId = await channel(workspaceId, ada, 'general');

    await deleteChannel(app.ctx, { channelId, userId: ada });
    const again = await createChannel(app.ctx, {
      workspaceId,
      userId: ada,
      name: 'general',
      topic: null,
      isPrivate: false,
      encrypted: false,
    });

    expect(again.ok).toBe(true);
  });
});

describe('telling people the list moved', () => {
  it('names everybody in the workspace when a public channel appears', async () => {
    /*
     * The other side used to find out by reloading. A channel is not a message
     * in a channel, so the fanout that carries messages cannot reach anybody
     * who is not subscribed to it yet, which is precisely everybody.
     */
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    const grace = await member(workspaceId, 'grace');

    const told: string[] = [];
    app.ctx.hub.publishToUser = (userId, event) => {
      if (event.type === 'channels_changed') told.push(userId);
    };

    await channel(workspaceId, ada, 'general');
    expect(told.sort()).toEqual([ada, grace].sort());
  });

  it('keeps a private channel to the people in it', async () => {
    const ada = await person('ada');
    const workspaceId = await workspace(ada);
    await member(workspaceId, 'grace');

    const told: string[] = [];
    app.ctx.hub.publishToUser = (userId, event) => {
      if (event.type === 'channels_changed') told.push(userId);
    };

    await channel(workspaceId, ada, 'secret', true);
    expect(told).toEqual([ada]);
  });
});
