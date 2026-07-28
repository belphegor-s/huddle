import type { User } from '@huddle/core';
import { loadSession } from '@huddle/domain';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ApiContext, ApiEnv } from './context.js';

export const SESSION_COOKIE = 'huddle_session';

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

/**
 * The cookie holds an opaque token and nothing else. No user id, no claims,
 * nothing signed, so there is no token format for anyone to forge: the token
 * is either in the store or it is not.
 *
 * `lax` rather than `strict` because the magic link arrives as a top level
 * navigation from a mail client, and `strict` would drop the cookie on that
 * first hop and land the person on a signed out page.
 */
export function startSession(c: ApiContext, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: THIRTY_DAYS_SECONDS,
  });
}

export function endSession(c: ApiContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/** Resolves the session if there is one. Never rejects: routes decide that. */
export const withSession = createMiddleware<ApiEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE) ?? null;
  c.set('sessionToken', token);
  c.set('user', token ? await loadSession(c.var.ports, token) : null);
  await next();
});

/** Narrows the nullable session variable at the one point routes care about. */
export function currentUser(c: ApiContext): User {
  const user = c.var.user;
  if (!user) throw new HTTPException(401, { res: c.json({ error: 'unauthorized' }, 401) });
  return user;
}
