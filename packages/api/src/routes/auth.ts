import { RequestMagicLinkInput } from '@huddle/core';
import { requestMagicLink, signOut, verifyMagicLink } from '@huddle/domain';
import { Hono } from 'hono';
import { appUrl, clientIp, type ApiEnv } from '../context.js';
import { failure, jsonBody } from '../http.js';
import { endSession, startSession } from '../session.js';

export function authRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.post('/magic-link', async (c) => {
    const input = await jsonBody(c, RequestMagicLinkInput);
    const sent = await requestMagicLink(c.var.ports, {
      email: input.email,
      redirectTo: input.redirectTo,
      clientIp: clientIp(c),
      appUrl: appUrl(c),
    });

    if (!sent.ok) return failure(c, sent.error);
    return c.json({ ok: true, expiresAt: sent.value.expiresAt });
  });

  /*
   * A browser navigation rather than a fetch, because it is reached by
   * tapping a link in a mail client. It answers with a redirect either way,
   * so a dead link lands on the sign in screen with an explanation instead of
   * a bare error page.
   */
  routes.get('/callback', async (c) => {
    const token = c.req.query('token');
    if (!token) return c.redirect('/signin?error=missing_link');

    const verified = await verifyMagicLink(c.var.ports, token);
    if (!verified.ok) return c.redirect('/signin?error=link_expired');

    startSession(c, verified.value.sessionToken);
    return c.redirect(verified.value.redirectTo ?? '/');
  });

  routes.post('/signout', async (c) => {
    const token = c.var.sessionToken;
    if (token) await signOut(c.var.ports, token);
    endSession(c);
    return c.json({ ok: true });
  });

  return routes;
}
