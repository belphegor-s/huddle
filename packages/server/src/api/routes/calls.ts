import type { IceServer } from '@huddle/core';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import type { AppContext } from '../../context.js';
import type { ApiEnv } from '../env.js';
import { currentUser } from '../session.js';

export function callRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  /*
   * Fetched just before a call starts rather than at boot, because a minted
   * credential expires and one handed out at page load would already be
   * stale by the time somebody joins.
   */
  routes.get('/calls/ice', (c) => c.json({ iceServers: iceServers(c.var.app, currentUser(c).id) }));

  return routes;
}

/**
 * Empty unless a relay is configured, which is a working deployment: two
 * browsers that can reach each other need no help. What a relay buys is the
 * symmetric NAT case, where neither end can be reached from outside.
 */
export function iceServers(app: AppContext, userId: string): IceServer[] {
  const { urls, secret, username, password, ttlSeconds } = app.config.turn;
  if (urls.length === 0) return [];

  if (secret !== '') {
    // The convention coturn implements for `use-auth-secret`: the username is
    // the expiry, and the password is its HMAC. Including the user makes a
    // leaked credential traceable, and the server never stores either.
    const expiry = Math.floor(app.now() / 1000) + ttlSeconds;
    const name = `${expiry}:${userId}`;

    return [
      {
        urls,
        username: name,
        credential: createHmac('sha1', secret).update(name).digest('base64'),
      },
    ];
  }

  if (username !== '') return [{ urls, username, credential: password }];

  return [{ urls }];
}
