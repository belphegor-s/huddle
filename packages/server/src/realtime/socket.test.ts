import { decodeServerEvent, ulid, type ClientEvent, type ServerEvent } from '@huddle/core';
import { memberships, users } from '@huddle/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../app.js';
import { createChannel, createWorkspace } from '../services/index.js';
import { createTestApp } from '../testing/index.js';
import { attachSocket, type Socket } from './socket.js';

let app: App;

beforeEach(async () => {
  app = await createTestApp();
});

afterEach(async () => {
  await app.close();
});

/**
 * Stands in for a WebSocket. The transport is the one thing here that is not
 * worth a real socket: the frames and the ordering are what the wire protocol
 * actually promises.
 */
class FakeSocket implements Socket {
  readonly received: ServerEvent[] = [];
  private readonly handlers = new Map<string, (payload: unknown) => void>();

  send(data: string): void {
    const event = decodeServerEvent(data);
    if (event) this.received.push(event);
  }

  close(): void {
    this.handlers.get('close')?.(undefined);
  }

  on(event: 'message' | 'close' | 'error', handler: (payload: never) => void): void {
    this.handlers.set(event, handler as (payload: unknown) => void);
  }

  /** Delivers a client frame and waits for the handler to finish with it. */
  async deliver(event: ClientEvent): Promise<void> {
    this.handlers.get('message')?.(JSON.stringify(event));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  ofType<T extends ServerEvent['type']>(type: T): Extract<ServerEvent, { type: T }>[] {
    return this.received.filter(
      (event): event is Extract<ServerEvent, { type: T }> => event.type === type,
    );
  }
}

async function seed(target: App, email: string) {
  const now = target.ctx.now();
  const userId = ulid(now);

  await target.ctx.db.insert(users).values({
    id: userId,
    email,
    displayName: email.split('@')[0] ?? email,
    avatarUrl: null,
    timezone: null,
    createdAt: now,
  });

  return userId;
}

describe('socket', () => {
  it('greets a connection with the wire version and who it is', async () => {
    const userId = await seed(app, 'ada@example.com');
    const socket = new FakeSocket();

    attachSocket(app.ctx, socket, userId);

    expect(socket.ofType('ready')[0]).toMatchObject({ userId, version: 1 });
  });

  it('delivers a message to another subscriber of the same channel', async () => {
    const adaId = await seed(app, 'ada@example.com');
    const samId = await seed(app, 'sam@example.com');

    const workspace = await createWorkspace(app.ctx, {
      userId: adaId,
      name: 'Acme',
      slug: 'acme',
    });
    if (!workspace.ok) throw new Error('workspace');

    await app.ctx.db.insert(memberships).values({
      workspaceId: workspace.value.workspace.id,
      userId: samId,
      role: 'member',
      joinedAt: app.ctx.now(),
    });

    const channel = await createChannel(app.ctx, {
      workspaceId: workspace.value.workspace.id,
      userId: adaId,
      name: 'general',
      topic: null,
      isPrivate: false,
    });
    if (!channel.ok) throw new Error('channel');

    const channelId = channel.value.channel.id;
    const ada = new FakeSocket();
    const sam = new FakeSocket();

    attachSocket(app.ctx, ada, adaId);
    attachSocket(app.ctx, sam, samId);

    await ada.deliver({ type: 'subscribe', channelId, lastSeq: 0 });
    await sam.deliver({ type: 'subscribe', channelId, lastSeq: 0 });

    await ada.deliver({
      type: 'send',
      channelId,
      draft: {
        id: ulid(),
        body: '{"type":"doc","content":[]}',
        text: 'anyone there',
        parentId: null,
        attachments: [],
        mentions: [],
      },
    });

    expect(sam.ofType('message').map((event) => event.message.text)).toEqual(['anyone there']);
    expect(ada.ofType('message').map((event) => event.message.text)).toEqual(['anyone there']);
  });

  it('replays the delta a reconnecting subscriber missed', async () => {
    const adaId = await seed(app, 'ada@example.com');

    const workspace = await createWorkspace(app.ctx, {
      userId: adaId,
      name: 'Acme',
      slug: 'acme',
    });
    if (!workspace.ok) throw new Error('workspace');

    const channel = await createChannel(app.ctx, {
      workspaceId: workspace.value.workspace.id,
      userId: adaId,
      name: 'general',
      topic: null,
      isPrivate: false,
    });
    if (!channel.ok) throw new Error('channel');

    const channelId = channel.value.channel.id;
    const first = new FakeSocket();
    attachSocket(app.ctx, first, adaId);
    await first.deliver({ type: 'subscribe', channelId, lastSeq: 0 });

    for (const text of ['one', 'two']) {
      await first.deliver({
        type: 'send',
        channelId,
        draft: {
          id: ulid(),
          body: '{"type":"doc","content":[]}',
          text,
          parentId: null,
          attachments: [],
          mentions: [],
        },
      });
    }

    const reconnected = new FakeSocket();
    attachSocket(app.ctx, reconnected, adaId);
    await reconnected.deliver({ type: 'subscribe', channelId, lastSeq: 1 });

    expect(reconnected.ofType('message').map((event) => event.message.text)).toEqual(['two']);
    expect(reconnected.ofType('synced')[0]).toMatchObject({ channelId, seq: 2 });
  });

  it('refuses a channel the connection cannot read', async () => {
    const adaId = await seed(app, 'ada@example.com');
    const malloryId = await seed(app, 'mallory@example.com');

    const workspace = await createWorkspace(app.ctx, {
      userId: adaId,
      name: 'Acme',
      slug: 'acme',
    });
    if (!workspace.ok) throw new Error('workspace');

    const channel = await createChannel(app.ctx, {
      workspaceId: workspace.value.workspace.id,
      userId: adaId,
      name: 'general',
      topic: null,
      isPrivate: false,
    });
    if (!channel.ok) throw new Error('channel');

    const mallory = new FakeSocket();
    attachSocket(app.ctx, mallory, malloryId);
    await mallory.deliver({ type: 'subscribe', channelId: channel.value.channel.id, lastSeq: 0 });

    expect(mallory.ofType('error')[0]).toMatchObject({ code: 'not_found' });
    expect(mallory.ofType('synced')).toHaveLength(0);
  });

  it('stops delivering once the socket closes', async () => {
    const adaId = await seed(app, 'ada@example.com');

    const workspace = await createWorkspace(app.ctx, {
      userId: adaId,
      name: 'Acme',
      slug: 'acme',
    });
    if (!workspace.ok) throw new Error('workspace');

    const channel = await createChannel(app.ctx, {
      workspaceId: workspace.value.workspace.id,
      userId: adaId,
      name: 'general',
      topic: null,
      isPrivate: false,
    });
    if (!channel.ok) throw new Error('channel');

    const channelId = channel.value.channel.id;
    const socket = new FakeSocket();
    attachSocket(app.ctx, socket, adaId);
    await socket.deliver({ type: 'subscribe', channelId, lastSeq: 0 });

    socket.close();
    expect(app.ctx.hub.presence(channelId)).toEqual([]);
  });
});
