import { ulid } from '@huddle/core';
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ChannelRoom } from '@huddle/adapter-cloudflare';

function room(channelId: string) {
  return env.CHANNEL_ROOM.get(env.CHANNEL_ROOM.idFromName(channelId));
}

function draft(text: string) {
  return { id: ulid(), body: JSON.stringify({ text }), text, parentId: null, attachments: [], mentions: [] };
}

describe('ChannelRoom', () => {
  it('assigns sequences densely and in order', async () => {
    const channelId = ulid();
    const authorId = ulid();

    const seqs: number[] = [];
    for (const text of ['one', 'two', 'three']) {
      const message = await room(channelId).append({
        channelId,
        authorId,
        draft: draft(text),
        now: Date.now(),
      });
      seqs.push(message.seq);
    }

    expect(seqs).toEqual([1, 2, 3]);
  });

  it('keeps sequences unique when sends arrive concurrently', async () => {
    const channelId = ulid();
    const authorId = ulid();

    // The single writer property is the whole reason messages live in a
    // Durable Object, so it is worth asserting directly.
    const messages = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        room(channelId).append({
          channelId,
          authorId,
          draft: draft(`concurrent ${i}`),
          now: Date.now(),
        }),
      ),
    );

    const seqs = messages.map((m) => m.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(25);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('treats a resent client id as a retry', async () => {
    const channelId = ulid();
    const authorId = ulid();
    const retry = draft('exactly once');

    const first = await room(channelId).append({ channelId, authorId, draft: retry, now: 1 });
    const second = await room(channelId).append({ channelId, authorId, draft: retry, now: 2 });

    expect(second.seq).toBe(first.seq);
    const page = await room(channelId).since({ channelId, afterSeq: 0, limit: 50 });
    expect(page.messages).toHaveLength(1);
  });

  it('replays only the delta a reconnecting client is missing', async () => {
    const channelId = ulid();
    const authorId = ulid();
    for (const text of ['a', 'b', 'c', 'd']) {
      await room(channelId).append({ channelId, authorId, draft: draft(text), now: Date.now() });
    }

    const page = await room(channelId).since({ channelId, afterSeq: 2, limit: 50 });
    expect(page.messages.map((m) => m.text)).toEqual(['c', 'd']);
    expect(page.latestSeq).toBe(4);
    expect(page.hasMore).toBe(false);
  });

  it('returns history oldest first and reports more when the page is full', async () => {
    const channelId = ulid();
    const authorId = ulid();
    for (let i = 0; i < 5; i++) {
      await room(channelId).append({
        channelId,
        authorId,
        draft: draft(`m${i}`),
        now: Date.now(),
      });
    }

    const page = await room(channelId).history({ channelId, limit: 3 });
    expect(page.messages.map((m) => m.text)).toEqual(['m2', 'm3', 'm4']);
    expect(page.hasMore).toBe(true);
  });

  it('keeps the sequence dense after a delete so reconnect still sees it', async () => {
    const channelId = ulid();
    const authorId = ulid();
    const target = await room(channelId).append({
      channelId,
      authorId,
      draft: draft('regrettable'),
      now: Date.now(),
    });

    const deleted = await room(channelId).softDelete({ messageId: target.id, now: Date.now() });
    expect(deleted).toEqual({ messageId: target.id, seq: target.seq });

    const page = await room(channelId).since({ channelId, afterSeq: 0, limit: 50 });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.text).toBe('');
    expect(page.messages[0]?.deletedAt).not.toBeNull();
  });

  it('refuses an edit from someone who is not the author', async () => {
    const channelId = ulid();
    const authorId = ulid();
    const message = await room(channelId).append({
      channelId,
      authorId,
      draft: draft('mine'),
      now: Date.now(),
    });

    const result = await room(channelId).edit({
      channelId,
      messageId: message.id,
      authorId: ulid(),
      body: JSON.stringify({ text: 'not mine' }),
      text: 'not mine',
      now: Date.now(),
    });

    expect(result).toBeNull();
  });

  it('drops an emoji once its last reactor removes it', async () => {
    const channelId = ulid();
    const userId = ulid();
    const message = await room(channelId).append({
      channelId,
      authorId: userId,
      draft: draft('react to me'),
      now: Date.now(),
    });

    await room(channelId).toggleReaction({ messageId: message.id, userId, emoji: '🔥', on: true });
    const after = await room(channelId).toggleReaction({
      messageId: message.id,
      userId,
      emoji: '🔥',
      on: false,
    });

    expect(after).toEqual([]);
  });

  it('persists across an eviction', async () => {
    const channelId = ulid();
    const authorId = ulid();
    await room(channelId).append({
      channelId,
      authorId,
      draft: draft('survive'),
      now: Date.now(),
    });

    const stub = room(channelId);
    await runInDurableObject(stub, async (_instance: ChannelRoom, state: DurableObjectState) => {
      await state.blockConcurrencyWhile(async () => {
        await state.storage.sync();
      });
    });

    const page = await stub.since({ channelId, afterSeq: 0, limit: 10 });
    expect(page.messages[0]?.text).toBe('survive');
  });
});
