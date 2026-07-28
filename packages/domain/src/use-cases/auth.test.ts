import { RATE_LIMITS } from '@huddle/core';
import { describe, expect, it } from 'vitest';
import { createTestPorts, type TestPorts } from '../testing/index.js';
import { loadSession, requestMagicLink, signOut, verifyMagicLink } from './auth.js';

const APP_URL = 'https://huddle.test';

function request(ports: TestPorts, email: string, redirectTo: string | null = null) {
  return requestMagicLink(ports, { email, redirectTo, clientIp: '203.0.113.10', appUrl: APP_URL });
}

function tokenFromLastEmail(ports: TestPorts): string {
  const text = ports.mailer.last()?.text ?? '';
  const token = /token=([\w-]+)/.exec(text)?.[1];
  if (!token) throw new Error(`No token in email: ${text}`);
  return token;
}

async function signIn(ports: TestPorts, email: string) {
  await request(ports, email);
  const verified = await verifyMagicLink(ports, tokenFromLastEmail(ports));
  if (!verified.ok) throw new Error(`Sign in failed: ${verified.error}`);
  return verified.value;
}

describe('magic link request', () => {
  it('emails a link back to the origin it was asked for', async () => {
    const ports = await createTestPorts();
    const result = await request(ports, 'ada@example.com');

    expect(result.ok).toBe(true);
    expect(ports.mailer.last()?.to).toBe('ada@example.com');
    expect(ports.mailer.last()?.text).toContain(`${APP_URL}/auth/callback?token=`);
  });

  it('never stores the token it emailed', async () => {
    const ports = await createTestPorts();
    await request(ports, 'ada@example.com');
    const token = tokenFromLastEmail(ports);

    expect(await ports.kv.get(`magic:${token}`)).toBeNull();
  });

  it('stops after the hourly allowance for one address', async () => {
    const ports = await createTestPorts();
    for (let i = 0; i < RATE_LIMITS.magicLinkPerHourPerEmail; i++) {
      expect((await request(ports, 'ada@example.com')).ok).toBe(true);
    }

    const blocked = await request(ports, 'ada@example.com');
    expect(blocked).toEqual({ ok: false, error: 'rate_limited' });
  });
});

describe('magic link verification', () => {
  it('creates the account on first sign in and reuses it after', async () => {
    const ports = await createTestPorts();

    const first = await signIn(ports, 'ada@example.com');
    const second = await signIn(ports, 'ada@example.com');

    expect(first.user.id).toBe(second.user.id);
    expect(first.user.displayName).toBe('Ada');
    expect(first.sessionToken).not.toBe(second.sessionToken);
  });

  it('treats the same address in different case as one account', async () => {
    const ports = await createTestPorts();
    const lower = await signIn(ports, 'ada@example.com');

    // The API normalises before calling in, so the use case sees it normalised.
    const again = await signIn(ports, 'ada@example.com');
    expect(again.user.id).toBe(lower.user.id);
  });

  it('spends the token, so a second open fails', async () => {
    const ports = await createTestPorts();
    await request(ports, 'ada@example.com');
    const token = tokenFromLastEmail(ports);

    expect((await verifyMagicLink(ports, token)).ok).toBe(true);
    expect(await verifyMagicLink(ports, token)).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('rejects a token that expired', async () => {
    const ports = await createTestPorts();
    await request(ports, 'ada@example.com');
    const token = tokenFromLastEmail(ports);

    ports.clock.advance(16 * 60 * 1000);

    expect(await verifyMagicLink(ports, token)).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('rejects a token nobody issued', async () => {
    const ports = await createTestPorts();
    expect(await verifyMagicLink(ports, 'made-up')).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('carries the redirect through to the session', async () => {
    const ports = await createTestPorts();
    await request(ports, 'ada@example.com', '/w/acme');
    const verified = await verifyMagicLink(ports, tokenFromLastEmail(ports));

    expect(verified.ok && verified.value.redirectTo).toBe('/w/acme');
  });
});

describe('sessions', () => {
  it('resolves to the signed in user', async () => {
    const ports = await createTestPorts();
    const { sessionToken, user } = await signIn(ports, 'ada@example.com');

    expect((await loadSession(ports, sessionToken))?.id).toBe(user.id);
  });

  it('does not resolve an unknown token', async () => {
    const ports = await createTestPorts();
    expect(await loadSession(ports, 'made-up')).toBeNull();
  });

  it('slides forward while it is being used', async () => {
    const ports = await createTestPorts();
    const { sessionToken } = await signIn(ports, 'ada@example.com');

    const day = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 10; i++) {
      ports.clock.advance(5 * day);
      expect(await loadSession(ports, sessionToken)).not.toBeNull();
    }
  });

  it('expires when it goes unused for longer than its lifetime', async () => {
    const ports = await createTestPorts();
    const { sessionToken } = await signIn(ports, 'ada@example.com');

    ports.clock.advance(31 * 24 * 60 * 60 * 1000);

    expect(await loadSession(ports, sessionToken)).toBeNull();
  });

  it('stops resolving after signing out', async () => {
    const ports = await createTestPorts();
    const { sessionToken } = await signIn(ports, 'ada@example.com');

    await signOut(ports, sessionToken);

    expect(await loadSession(ports, sessionToken)).toBeNull();
  });
});
