import { ulid, type Channel, type Message } from '@huddle/core';
import { channelMembers, memberships, pushSubscriptions, users } from '@huddle/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../app.js';
import type { PushPayload, PushResult, PushSender, PushSubscription } from '../storage/push.js';
import { createTestApp } from '../testing/index.js';
import { createChannel, createWorkspace } from './index.js';
import { notifyNewMessage, savePushSubscription } from './notifications.js';

/** Records what would have been sent, and can pretend a browser is gone. */
class RecordingPush implements PushSender {
  readonly available = true;
  readonly publicKey = 'test-public-key';
  readonly sent: Array<{ endpoint: string; payload: PushPayload }> = [];
  expired = new Set<string>();

  async send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult> {
    if (this.expired.has(subscription.endpoint)) {
      return { ok: false, expired: true, reason: 'gone' };
    }
    this.sent.push({ endpoint: subscription.endpoint, payload });
    return { ok: true };
  }
}

let app: App;
let push: RecordingPush;

beforeEach(async () => {
  app = await createTestApp();
  push = new RecordingPush();
  app.ctx.push = push;
});

afterEach(async () => {
  await app.close();
});

async function person(email: string): Promise<string> {
  const now = app.ctx.now();
  const id = ulid(now);

  await app.ctx.db.insert(users).values({
    id,
    email,
    displayName: email.split('@')[0] ?? email,
    avatarUrl: null,
    timezone: null,
    createdAt: now,
  });

  return id;
}

async function room(): Promise<{ channel: Channel; ada: string; sam: string }> {
  const ada = await person('ada@example.com');
  const sam = await person('sam@example.com');

  const workspace = await createWorkspace(app.ctx, { userId: ada, name: 'Acme', slug: 'acme' });
  if (!workspace.ok) throw new Error('workspace');

  await app.ctx.db.insert(memberships).values({
    workspaceId: workspace.value.workspace.id,
    userId: sam,
    role: 'member',
    joinedAt: app.ctx.now(),
  });

  const channel = await createChannel(app.ctx, {
    workspaceId: workspace.value.workspace.id,
    userId: ada,
    name: 'general',
    topic: null,
    isPrivate: false,
    encrypted: false,
  });
  if (!channel.ok) throw new Error('channel');

  await app.ctx.db
    .insert(channelMembers)
    .values({ channelId: channel.value.channel.id, userId: sam, joinedAt: app.ctx.now() });

  return { channel: channel.value.channel, ada, sam };
}

async function subscribe(userId: string, endpoint: string): Promise<void> {
  const saved = await savePushSubscription(app.ctx, {
    userId,
    endpoint,
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    userAgent: null,
  });
  if (!saved.ok) throw new Error('subscribe');
}

function messageFrom(channel: Channel, authorId: string, text: string, mentions: string[] = []) {
  return {
    id: ulid(),
    channelId: channel.id,
    seq: 1,
    authorId,
    body: '{"type":"doc","content":[]}',
    text,
    parentId: null,
    epoch: null,
    replyCount: 0,
    attachments: [],
    reactions: [],
    mentions,
    createdAt: app.ctx.now(),
    editedAt: null,
    deletedAt: null,
  } satisfies Message;
}

describe('push subscriptions', () => {
  it('updates the row when the same browser subscribes again', async () => {
    const ada = await person('ada@example.com');

    await subscribe(ada, 'https://push.example.com/one');
    await subscribe(ada, 'https://push.example.com/one');

    const rows = await app.ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ada));

    expect(rows).toHaveLength(1);
  });
});

describe('notifying a channel', () => {
  it('tells the other members and never the author', async () => {
    const { channel, ada, sam } = await room();
    await subscribe(ada, 'https://push.example.com/ada');
    await subscribe(sam, 'https://push.example.com/sam');

    await notifyNewMessage(app.ctx, {
      channel,
      message: messageFrom(channel, ada, 'anyone there'),
    });

    expect(push.sent.map((entry) => entry.endpoint)).toEqual(['https://push.example.com/sam']);
    expect(push.sent[0]?.payload).toMatchObject({
      title: 'ada in #general',
      body: 'anyone there',
      tag: channel.id,
      url: '/w/acme/c/general',
    });
  });

  it('stays quiet for someone who has the channel open', async () => {
    const { channel, ada, sam } = await room();
    await subscribe(sam, 'https://push.example.com/sam');

    const subscriber = {
      id: 'socket-1',
      userId: sam,
      channels: new Set<string>(),
      send() {},
    };
    app.ctx.hub.add(subscriber);
    app.ctx.hub.subscribe(subscriber, channel.id);

    await notifyNewMessage(app.ctx, {
      channel,
      message: messageFrom(channel, ada, 'you are already looking at this'),
    });

    expect(push.sent).toHaveLength(0);
  });

  it('respects a mentions only preference', async () => {
    const { channel, ada, sam } = await room();
    await subscribe(sam, 'https://push.example.com/sam');
    await app.ctx.db
      .update(channelMembers)
      .set({ notificationLevel: 'mentions' })
      .where(eq(channelMembers.userId, sam));

    await notifyNewMessage(app.ctx, {
      channel,
      message: messageFrom(channel, ada, 'general chatter'),
    });
    expect(push.sent).toHaveLength(0);

    await notifyNewMessage(app.ctx, {
      channel,
      message: messageFrom(channel, ada, '@sam a word', [sam]),
    });
    expect(push.sent).toHaveLength(1);
  });

  it('stays quiet while a channel is muted', async () => {
    const { channel, ada, sam } = await room();
    await subscribe(sam, 'https://push.example.com/sam');
    await app.ctx.db
      .update(channelMembers)
      .set({ mutedUntil: app.ctx.now() + 60_000 })
      .where(eq(channelMembers.userId, sam));

    await notifyNewMessage(app.ctx, {
      channel,
      message: messageFrom(channel, ada, 'not now'),
    });

    expect(push.sent).toHaveLength(0);
  });

  it('describes a voice note rather than sending an empty body', async () => {
    const { channel, ada, sam } = await room();
    await subscribe(sam, 'https://push.example.com/sam');

    await notifyNewMessage(app.ctx, {
      channel,
      message: {
        ...messageFrom(channel, ada, ''),
        attachments: [
          {
            id: ulid(),
            kind: 'audio',
            name: 'voice.webm',
            mimeType: 'audio/webm',
            size: 1024,
            url: '/api/files/x',
            width: null,
            height: null,
            durationMs: 4000,
            peaks: null,
          },
        ],
      },
    });

    expect(push.sent[0]?.payload.body).toBe('Sent a voice note');
  });

  it('forgets a subscription the browser has thrown away', async () => {
    const { channel, ada, sam } = await room();
    await subscribe(sam, 'https://push.example.com/sam');
    push.expired.add('https://push.example.com/sam');

    await notifyNewMessage(app.ctx, {
      channel,
      message: messageFrom(channel, ada, 'gone'),
    });

    const rows = await app.ctx.db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(0);
  });
});
