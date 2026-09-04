import { LIMITS, ulid } from '@huddle/core';
import { memberships, users } from '@huddle/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../app.js';
import { iceServers } from '../api/routes/calls.js';
import type { Subscriber } from '../realtime/hub.js';
import { createTestApp } from '../testing/index.js';
import { joinCall, leaveCall, relaySignal, roster, updateCallState } from './calls.js';
import { createChannel, createWorkspace, joinChannel, listChannels } from './index.js';

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

async function room() {
  const ownerId = await person('ada');
  const created = await createWorkspace(app.ctx, { userId: ownerId, name: 'Acme', slug: 'acme' });
  if (!created.ok) throw new Error('workspace');

  const channel = await createChannel(app.ctx, {
    workspaceId: created.value.workspace.id,
    userId: ownerId,
    name: 'general',
    topic: null,
    isPrivate: false,
    encrypted: false,
  });
  if (!channel.ok) throw new Error('channel');

  return {
    ownerId,
    workspaceId: created.value.workspace.id,
    channelId: channel.value.channel.id,
  };
}

/** Somebody in the workspace and in the channel, ready to be called. */
async function teammate(workspaceId: string, channelId: string, name: string): Promise<string> {
  const userId = await person(name);

  await app.ctx.db.insert(memberships).values({
    workspaceId,
    userId,
    role: 'member',
    joinedAt: app.ctx.now(),
  });
  await joinChannel(app.ctx, { channelId, userId });

  return userId;
}

/** A connected client, so a test can read what the hub actually delivered. */
function listener(userId: string): Subscriber & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    id: ulid(app.ctx.now()),
    userId,
    channels: new Set<string>(),
    events,
    send(event) {
      events.push(event);
    },
  };
}

describe('calls', () => {
  it('puts a caller on the roster and takes them off again', async () => {
    const { ownerId, channelId } = await room();

    const joined = await joinCall(app.ctx, {
      channelId,
      userId: ownerId,
      sessionId: 'session-one',
      video: true,
    });

    expect(joined.ok).toBe(true);
    expect(joined.ok && joined.value).toHaveLength(1);
    expect(joined.ok && joined.value[0]?.video).toBe(true);

    await leaveCall(app.ctx, { sessionId: 'session-one' });
    expect(await roster(app.ctx, channelId)).toHaveLength(0);
  });

  it('refuses a channel the caller cannot see', async () => {
    const { channelId } = await room();
    const outsider = await person('mallory');

    const joined = await joinCall(app.ctx, {
      channelId,
      userId: outsider,
      sessionId: 'session-one',
      video: false,
    });

    expect(joined.ok).toBe(false);
    // A channel you cannot reach reads as missing rather than refused.
    expect(joined.ok === false && joined.error).toBe('not_found');
  });

  it('counts one person on two devices as two participants', async () => {
    const { ownerId, channelId } = await room();

    await joinCall(app.ctx, { channelId, userId: ownerId, sessionId: 'laptop', video: false });
    await joinCall(app.ctx, { channelId, userId: ownerId, sessionId: 'phone', video: false });

    expect(await roster(app.ctx, channelId)).toHaveLength(2);
  });

  it('stops letting people in once the mesh is full', async () => {
    const { workspaceId, channelId } = await room();

    for (let index = 0; index < LIMITS.callParticipantsMax; index++) {
      const userId = await teammate(workspaceId, channelId, `guest${index}`);
      const joined = await joinCall(app.ctx, {
        channelId,
        userId,
        sessionId: `session-${index}`,
        video: false,
      });
      expect(joined.ok).toBe(true);
    }

    const lateId = await teammate(workspaceId, channelId, 'late');
    const late = await joinCall(app.ctx, {
      channelId,
      userId: lateId,
      sessionId: 'session-late',
      video: false,
    });

    expect(late.ok === false && late.error).toBe('call_full');
  });

  it('lets somebody already in the call rejoin a full one', async () => {
    const { workspaceId, channelId } = await room();

    for (let index = 0; index < LIMITS.callParticipantsMax; index++) {
      const userId = await teammate(workspaceId, channelId, `guest${index}`);
      await joinCall(app.ctx, { channelId, userId, sessionId: `session-${index}`, video: false });
    }

    // A reconnect during a call is the same connection arriving twice, and it
    // must not be turned away by the room it is already in.
    const present = await roster(app.ctx, channelId);
    const again = await joinCall(app.ctx, {
      channelId,
      userId: present[0]?.userId ?? '',
      sessionId: present[0]?.sessionId ?? '',
      video: true,
    });

    expect(again.ok).toBe(true);
    expect(again.ok && again.value).toHaveLength(LIMITS.callParticipantsMax);
  });

  it('drops a participant who stopped heartbeating', async () => {
    const { ownerId, channelId } = await room();
    let clock = Date.now();
    app.ctx.now = () => clock;

    await joinCall(app.ctx, { channelId, userId: ownerId, sessionId: 'ghost', video: false });
    clock += LIMITS.callStaleMs + 1;

    expect(await roster(app.ctx, channelId)).toHaveLength(0);
  });

  it('forwards a signal to the other end', async () => {
    const { ownerId, workspaceId, channelId } = await room();
    const otherId = await teammate(workspaceId, channelId, 'grace');

    await joinCall(app.ctx, { channelId, userId: ownerId, sessionId: 'from', video: false });
    await joinCall(app.ctx, { channelId, userId: otherId, sessionId: 'to', video: false });

    const receiver = listener(otherId);
    app.ctx.hub.add(receiver);
    receiver.events.length = 0;

    const relayed = await relaySignal(app.ctx, {
      channelId,
      userId: ownerId,
      sessionId: 'from',
      to: 'to',
      data: '{"type":"offer"}',
    });

    expect(relayed.ok).toBe(true);
    expect(receiver.events).toContainEqual({
      type: 'call_signal',
      channelId,
      from: 'from',
      fromUserId: ownerId,
      to: 'to',
      data: '{"type":"offer"}',
    });
  });

  it('refuses to relay for somebody who is not in the call', async () => {
    const { ownerId, channelId } = await room();
    await joinCall(app.ctx, { channelId, userId: ownerId, sessionId: 'inside', video: false });

    const relayed = await relaySignal(app.ctx, {
      channelId,
      userId: ownerId,
      sessionId: 'outside',
      to: 'inside',
      data: 'x',
    });

    expect(relayed.ok === false && relayed.error).toBe('not_in_call');
  });

  it('publishes the new roster to the channel when somebody joins', async () => {
    const { ownerId, channelId } = await room();

    const watcher = listener(ownerId);
    app.ctx.hub.add(watcher);
    app.ctx.hub.subscribe(watcher, channelId);
    watcher.events.length = 0;

    await joinCall(app.ctx, { channelId, userId: ownerId, sessionId: 'one', video: false });

    expect(watcher.events).toContainEqual(
      expect.objectContaining({ type: 'call_roster', channelId }),
    );
    expect(watcher.events).toContainEqual({ type: 'call_activity', channelId, count: 1 });
  });

  it('changes a caller state only on their own row', async () => {
    const { ownerId, workspaceId, channelId } = await room();
    const otherId = await teammate(workspaceId, channelId, 'grace');

    await joinCall(app.ctx, { channelId, userId: ownerId, sessionId: 'mine', video: false });
    await joinCall(app.ctx, { channelId, userId: otherId, sessionId: 'theirs', video: false });

    await updateCallState(app.ctx, {
      sessionId: 'mine',
      muted: true,
      video: true,
      sharing: true,
    });

    const present = await roster(app.ctx, channelId);
    expect(present.find((one) => one.sessionId === 'mine')?.muted).toBe(true);
    expect(present.find((one) => one.sessionId === 'theirs')?.muted).toBe(false);
  });

  it('tells the channel list where a call is happening', async () => {
    const { ownerId, workspaceId, channelId } = await room();
    await joinCall(app.ctx, { channelId, userId: ownerId, sessionId: 'one', video: false });

    const listed = await listChannels(app.ctx, { workspaceId, userId: ownerId });
    const summary = listed.ok ? listed.value.find((one) => one.channel.id === channelId) : null;

    expect(summary?.callCount).toBe(1);
  });
});

describe('ice servers', () => {
  it('offers nothing when no relay is configured', () => {
    expect(iceServers(app.ctx, 'user')).toEqual([]);
  });

  it('mints a credential that expires when given a shared secret', () => {
    app.ctx.config.turn = {
      urls: ['turn:relay.example:3478'],
      secret: 'shh',
      username: '',
      password: '',
      ttlSeconds: 600,
    };

    const [server] = iceServers(app.ctx, 'user-one');
    const expiry = Number(server?.username?.split(':')[0]);

    expect(server?.urls).toEqual(['turn:relay.example:3478']);
    expect(server?.username).toContain(':user-one');
    expect(expiry * 1000).toBeGreaterThan(app.ctx.now());
    expect(server?.credential).toBeTruthy();
  });

  it('passes a fixed credential through untouched', () => {
    app.ctx.config.turn = {
      urls: ['turn:relay.example:3478'],
      secret: '',
      username: 'huddle',
      password: 'hunter2',
      ttlSeconds: 600,
    };

    expect(iceServers(app.ctx, 'user')).toEqual([
      { urls: ['turn:relay.example:3478'], username: 'huddle', credential: 'hunter2' },
    ]);
  });
});
