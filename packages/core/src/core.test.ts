import { describe, expect, it } from 'vitest';
import { isUlid, ulid, ulidTime } from './ids.js';
import { Email, ImageRef, InternalPath, RequestMagicLinkInput } from './schemas.js';
import { hashToken, randomToken } from './tokens.js';
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
        body: JSON.stringify({ type: 'doc', content: [] }),
        text: 'hello',
        parentId: null,
        attachments: [],
        mentions: [],
        epoch: null,
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

describe('email', () => {
  it('normalises case and surrounding space', () => {
    expect(Email.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects an address that is not one', () => {
    expect(Email.safeParse('ada at example').success).toBe(false);
  });
});

describe('redirect targets', () => {
  it('accepts a path on this site', () => {
    expect(InternalPath.parse('/w/acme?tab=all')).toBe('/w/acme?tab=all');
  });

  it.each(['//evil.example', 'https://evil.example', 'javascript:alert(1)', 'w/acme'])(
    'rejects %s',
    (value) => {
      expect(InternalPath.safeParse(value).success).toBe(false);
    },
  );

  it('defaults a missing redirect to null', () => {
    expect(RequestMagicLinkInput.parse({ email: 'ada@example.com' }).redirectTo).toBeNull();
  });
});

describe('tokens', () => {
  it('does not repeat across a large batch', () => {
    const tokens = new Set(Array.from({ length: 10_000 }, () => randomToken()));
    expect(tokens.size).toBe(10_000);
  });

  it('is url safe', () => {
    expect(randomToken()).toMatch(/^[\w-]+$/);
  });

  it('hashes to a stable 64 character digest', async () => {
    const first = await hashToken('correct horse battery staple');
    const second = await hashToken('correct horse battery staple');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken('correct horse battery stapld')).not.toBe(first);
  });
});

describe('image references', () => {
  it('accepts a picture served by this deployment', () => {
    // What an upload produces. A strict URL check rejects it, which is why
    // avatars were refused with a validation error nobody ever saw.
    expect(ImageRef.safeParse('/api/files/01HZY8').success).toBe(true);
  });

  it('accepts a picture hosted elsewhere', () => {
    expect(ImageRef.safeParse('https://example.com/face.png').success).toBe(true);
  });

  it('refuses anything that is not a location', () => {
    expect(ImageRef.safeParse('javascript:alert(1)').success).toBe(false);
    expect(ImageRef.safeParse('face.png').success).toBe(false);
    expect(ImageRef.safeParse('').success).toBe(false);
  });
});
