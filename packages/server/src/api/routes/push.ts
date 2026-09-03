import { Hono } from 'hono';
import { z } from 'zod';
import { removePushSubscription, savePushSubscription } from '../../services/index.js';
import type { ApiEnv } from '../env.js';
import { failure, jsonBody } from '../http.js';
import { currentUser } from '../session.js';

/** The shape `PushSubscription.toJSON()` produces in every browser. */
const SubscribeInput = z.object({
  endpoint: z.url(),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

const UnsubscribeInput = z.object({ endpoint: z.url() });

export function pushRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  /*
   * Readable by any signed in caller, and public by design: the VAPID public
   * key is what the browser needs to create a subscription, and it identifies
   * this server rather than authorising anything.
   */
  routes.get('/push/key', (c) =>
    c.json({
      available: c.var.app.push.available,
      publicKey: c.var.app.push.publicKey,
    }),
  );

  routes.post('/push/subscriptions', async (c) => {
    const input = await jsonBody(c, SubscribeInput);
    const saved = await savePushSubscription(c.var.app, {
      userId: currentUser(c).id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: c.req.header('user-agent') ?? null,
    });

    if (!saved.ok) return failure(c, saved.error);
    return c.json({ ok: true }, 201);
  });

  routes.delete('/push/subscriptions', async (c) => {
    const input = await jsonBody(c, UnsubscribeInput);
    currentUser(c);
    await removePushSubscription(c.var.app, input.endpoint);
    return c.json({ ok: true });
  });

  return routes;
}
