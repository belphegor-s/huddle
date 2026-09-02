import type { User } from '@huddle/core';
import type { AppContext } from '../context.js';
import { loadSession } from '../services/auth.js';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ApiContext, ApiEnv } from './env.js';

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
  c.set('user', token ? await loadSession(c.var.app, token) : null);
  await next();
});

/**
 * The same lookup, for callers holding a bare Request rather than a Hono
 * context. React Router loaders use this, so a page render and an API call
 * agree on who is signed in without one of them having to call the other.
 */
export async function sessionFromRequest(app: AppContext, request: Request): Promise<User | null> {
  const token = sessionTokenFrom(request);
  return token ? loadSession(app, token) : null;
}

export function sessionTokenFrom(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }

  return null;
}

/** For callers that set headers directly rather than through a Hono context. */
export const CLEARED_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

/** Narrows the nullable session variable at the one point routes care about. */
export function currentUser(c: ApiContext): User {
  const user = c.var.user;
  if (!user) throw new HTTPException(401, { res: c.json({ error: 'unauthorized' }, 401) });
  return user;
}
