import { Hono } from 'hono';
import { z } from 'zod';
import { catchUp, summariseThread } from '../../services/index.js';
import type { ApiEnv } from '../env.js';
import { failure, jsonBody } from '../http.js';
import { currentUser } from '../session.js';

const CatchUpInput = z.object({ sinceSeq: z.number().int().nonnegative() });

/**
 * Every route here is off unless the deployment has configured a model, and
 * each one reads only messages the caller can already see: the channel guard
 * runs before a single line reaches the provider.
 */
export function assistantRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.post('/channels/:channelId/threads/:parentId/summary', async (c) => {
    const summary = await summariseThread(c.var.app, {
      channelId: c.req.param('channelId'),
      parentId: c.req.param('parentId'),
      userId: currentUser(c).id,
    });

    if (!summary.ok) return failure(c, summary.error);
    return c.json({ text: summary.value });
  });

  routes.post('/channels/:channelId/catch-up', async (c) => {
    const input = await jsonBody(c, CatchUpInput);
    const caught = await catchUp(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      sinceSeq: input.sinceSeq,
    });

    if (!caught.ok) return failure(c, caught.error);
    return c.json({ text: caught.value });
  });

  return routes;
}
