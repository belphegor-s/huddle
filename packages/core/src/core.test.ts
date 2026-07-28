import { describe, expect, it } from 'vitest';
import { isUlid, ulid, ulidTime } from './ids.js';
import { ClientEvent, decodeClientEvent, encodeEvent } from './wire.js';

describe('ulid', () => {
  it('produces 26 valid characters', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it('round trips the timestamp', () => {
    const now = 1_760_000_000_000;
    expect(ulidTime(ulid(now))).toBe(now);
  });

  it('sorts lexicographically by time', () => {
    const earlier = ulid(1_000_000_000_000);
    const later = ulid(2_000_000_000_000);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('does not collide across a large batch', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => ulid()));
    expect(ids.size).toBe(10_000);
  });
});

describe('wire protocol', () => {
  it('round trips a send event', () => {
    const event: ClientEvent = {
      type: 'send',
      channelId: ulid(),
      draft: {
        id: ulid(),
        body: { type: 'doc', content: [] },
        text: 'hello',
        parentId: null,
        attachments: [],
        mentions: [],
      },
    };
    expect(decodeClientEvent(encodeEvent(event))).toEqual(event);
  });

  it('rejects malformed json rather than throwing', () => {
    expect(decodeClientEvent('{ not json')).toBeNull();
  });

  it('rejects an unknown event type', () => {
    expect(decodeClientEvent(JSON.stringify({ type: 'drop_database' }))).toBeNull();
  });

  it('rejects a non ulid channel id', () => {
    const raw = JSON.stringify({ type: 'typing', channelId: 'nope' });
    expect(decodeClientEvent(raw)).toBeNull();
  });
});
