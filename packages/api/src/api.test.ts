import { createTestPorts, type TestPorts } from '@huddle/domain/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './index.js';

const ORIGIN = 'http://huddle.test';

let ports: TestPorts;
let app: ReturnType<typeof createApi>;

beforeEach(async () => {
  ports = await createTestPorts();
  app = createApi(ports);
});

function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.cookie) headers.set('cookie', init.cookie);
  return app.request(`${ORIGIN}${path}`, { ...init, headers });
}

function post(path: string, body: unknown, cookie?: string) {
  return call(path, { method: 'POST', body: JSON.stringify(body), cookie });
}

/** Signs someone in the way a browser would, and hands back their cookie. */
async function signIn(email: string): Promise<string> {
  const requested = await post('/api/auth/magic-link', { email });
  expect(requested.status).toBe(200);

  const token = /token=([\w-]+)/.exec(ports.mailer.last()?.text ?? '')?.[1];
  const callback = await call(`/api/auth/callback?token=${token}`);
  expect(callback.status).toBe(302);

  const cookie = callback.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Callback did not set a session cookie');
  return cookie;
}

describe('health', () => {
  it('answers without a session', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});

describe('signing in', () => {
  it('sets an http only session cookie and redirects home', async () => {
    const requested = await post('/api/auth/magic-link', { email: 'Ada@Example.com' });
    expect(requested.status).toBe(200);
    expect(ports.mailer.last()?.to).toBe('ada@example.com');

    const token = /token=([\w-]+)/.exec(ports.mailer.last()?.text ?? '')?.[1];
    const callback = await call(`/api/auth/callback?token=${token}`);

    expect(callback.headers.get('location')).toBe('/');
    expect(callback.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('honours a redirect that was asked for up front', async () => {
    await post('/api/auth/magic-link', { email: 'ada@example.com', redirectTo: '/w/acme' });
    const token = /token=([\w-]+)/.exec(ports.mailer.last()?.text ?? '')?.[1];

    const callback = await call(`/api/auth/callback?token=${token}`);
    expect(callback.headers.get('location')).toBe('/w/acme');
  });

  it('refuses a redirect pointing off site', async () => {
    const response = await post('/api/auth/magic-link', {
      email: 'ada@example.com',
      redirectTo: '//evil.example',
    });

    expect(response.status).toBe(400);
    expect(ports.mailer.sent).toHaveLength(0);
  });

  it('sends a spent link back to the sign in screen', async () => {
    await post('/api/auth/magic-link', { email: 'ada@example.com' });
    const token = /token=([\w-]+)/.exec(ports.mailer.last()?.text ?? '')?.[1];

    await call(`/api/auth/callback?token=${token}`);
    const again = await call(`/api/auth/callback?token=${token}`);

    expect(again.headers.get('location')).toBe('/signin?error=link_expired');
  });

  it('rejects an address that is not one', async () => {
    const response = await post('/api/auth/magic-link', { email: 'ada at example' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid' });
  });

  it('stops resolving the cookie after signing out', async () => {
    const cookie = await signIn('ada@example.com');
    expect((await call('/api/me', { cookie })).status).toBe(200);

    await post('/api/auth/signout', {}, cookie);

    expect((await call('/api/me', { cookie })).status).toBe(401);
  });
});

describe('guarded routes', () => {
  it.each(['/api/me', '/api/workspaces'])('refuses %s without a session', async (path) => {
    const response = await call(path);
    expect(response.status).toBe(401);
  });
});

describe('workspaces', () => {
  it('creates one and reports the creator as owner', async () => {
    const cookie = await signIn('ada@example.com');

    const created = await post('/api/workspaces', { name: 'Acme', slug: 'acme' }, cookie);
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ role: 'owner' });

    const me = await call('/api/me', { cookie });
    await expect(me.json()).resolves.toMatchObject({
      user: { email: 'ada@example.com' },
      workspaces: [{ role: 'owner' }],
    });
  });

  it('refuses a slug already taken', async () => {
    const ada = await signIn('ada@example.com');
    const sam = await signIn('sam@example.com');

    await post('/api/workspaces', { name: 'Acme', slug: 'acme' }, ada);
    const clash = await post('/api/workspaces', { name: 'Acme Two', slug: 'acme' }, sam);

    expect(clash.status).toBe(409);
  });

  it('rejects a slug with spaces rather than quietly fixing it', async () => {
    const cookie = await signIn('ada@example.com');
    const response = await post('/api/workspaces', { name: 'Acme', slug: 'Acme Corp' }, cookie);

    expect(response.status).toBe(400);
  });

  it('answers 404, not 403, to someone outside it', async () => {
    const ada = await signIn('ada@example.com');
    const stranger = await signIn('mallory@example.com');
    await post('/api/workspaces', { name: 'Acme', slug: 'acme' }, ada);

    const response = await call('/api/workspaces/acme', { cookie: stranger });
    expect(response.status).toBe(404);
  });
});

describe('invites', () => {
  async function acmeWithInvite() {
    const owner = await signIn('ada@example.com');
    const created = await post('/api/workspaces', { name: 'Acme', slug: 'acme' }, owner);
    const { workspace } = (await created.json()) as { workspace: { id: string } };

    const invite = await post(`/api/workspaces/${workspace.id}/invites`, {}, owner);
    const { token } = (await invite.json()) as { token: string };

    return { owner, workspaceId: workspace.id, token };
  }

  it('shows what is being joined before asking for a session', async () => {
    const { token } = await acmeWithInvite();

    const preview = await call(`/api/invites/${token}`);
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({ workspace: { name: 'Acme' } });
  });

  it('adds the invited person as a member', async () => {
    const { token } = await acmeWithInvite();
    const sam = await signIn('sam@example.com');

    const joined = await post(`/api/invites/${token}/accept`, {}, sam);
    expect(joined.status).toBe(200);
    await expect(joined.json()).resolves.toMatchObject({ role: 'member' });

    const visible = await call('/api/workspaces/acme', { cookie: sam });
    expect(visible.status).toBe(200);
  });

  it('does not let a member issue invites of their own', async () => {
    const { token, workspaceId } = await acmeWithInvite();
    const sam = await signIn('sam@example.com');
    await post(`/api/invites/${token}/accept`, {}, sam);

    const attempt = await post(`/api/workspaces/${workspaceId}/invites`, {}, sam);
    expect(attempt.status).toBe(403);
  });

  it('stops working once revoked', async () => {
    const { owner, workspaceId, token } = await acmeWithInvite();
    const invites = await ports.db.query.invites.findMany();
    const inviteId = invites[0]?.id;

    const revoked = await call(`/api/workspaces/${workspaceId}/invites/${inviteId}`, {
      method: 'DELETE',
      cookie: owner,
    });
    expect(revoked.status).toBe(200);

    const sam = await signIn('sam@example.com');
    expect((await post(`/api/invites/${token}/accept`, {}, sam)).status).toBe(404);
  });
});

describe('profile', () => {
  it('renames without clearing the fields it was not given', async () => {
    const cookie = await signIn('ada@example.com');
    await call('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Asia/Kolkata' }),
      cookie,
    });

    const renamed = await call('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Ada Lovelace' }),
      cookie,
    });

    await expect(renamed.json()).resolves.toMatchObject({
      displayName: 'Ada Lovelace',
      timezone: 'Asia/Kolkata',
    });
  });
});
