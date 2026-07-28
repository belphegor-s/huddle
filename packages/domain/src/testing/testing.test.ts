import { ulid } from '@huddle/core';
import { users } from '@huddle/db/schema';
import { describe, expect, it } from 'vitest';
import { createTestPorts } from './index.js';

function draft(text: string) {
  return {
    id: ulid(),
    body: JSON.stringify({ text }),
    text,
    parentId: null,
    attachments: [],
    mentions: [],
  };
}

describe('test ports', () => {
  it('gives a migrated database', async () => {
    const ports = await createTestPorts();
    const id = ulid();
    await ports.db.insert(users).values({
      id,
      email: 'a@example.com',
      displayName: 'A',
      avatarUrl: null,
      timezone: null,
      createdAt: ports.clock.now(),
    });
    const rows = await ports.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
  });

  it('assigns sequences in order and never reuses one', async () => {
    const ports = await createTestPorts();
    const channelId = ulid();
    const authorId = ulid();

    const first = await ports.messages.append({
      channelId,
      authorId,
      draft: draft('one'),
      now: ports.clock.now(),
    });
    const second = await ports.messages.append({
      channelId,
      authorId,
      draft: draft('two'),
      now: ports.clock.now(),
    });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
  });

  it('treats a resent client id as a retry rather than a duplicate', async () => {
    const ports = await createTestPorts();
    const channelId = ulid();
    const authorId = ulid();
    const retry = draft('only once');

    const a = await ports.messages.append({ channelId, authorId, draft: retry, now: 1 });
    const b = await ports.messages.append({ channelId, authorId, draft: retry, now: 2 });

    expect(b.seq).toBe(a.seq);
    const page = await ports.messages.since({ channelId, afterSeq: 0, limit: 10 });
    expect(page.messages).toHaveLength(1);
  });

  it('replays only what a reconnecting client is missing', async () => {
    const ports = await createTestPorts();
    const channelId = ulid();
    const authorId = ulid();
    for (const text of ['a', 'b', 'c']) {
      await ports.messages.append({ channelId, authorId, draft: draft(text), now: 1 });
    }

    const page = await ports.messages.since({ channelId, afterSeq: 1, limit: 10 });
    expect(page.messages.map((m) => m.text)).toEqual(['b', 'c']);
    expect(page.latestSeq).toBe(3);
  });

  it('expires key value entries against the fake clock', async () => {
    const ports = await createTestPorts();
    await ports.kv.set('token', 'value', { ttlSeconds: 60 });
    expect(await ports.kv.get('token')).toBe('value');
    ports.clock.advance(61_000);
    expect(await ports.kv.get('token')).toBeNull();
  });

  it('removes an emoji entirely once its last user unreacts', async () => {
    const ports = await createTestPorts();
    const channelId = ulid();
    const userId = ulid();
    const message = await ports.messages.append({
      channelId,
      authorId: userId,
      draft: draft('hi'),
      now: 1,
    });

    await ports.messages.toggleReaction({
      channelId,
      messageId: message.id,
      userId,
      emoji: '👍',
      on: true,
    });
    const after = await ports.messages.toggleReaction({
      channelId,
      messageId: message.id,
      userId,
      emoji: '👍',
      on: false,
    });

    expect(after).toEqual([]);
  });
});
