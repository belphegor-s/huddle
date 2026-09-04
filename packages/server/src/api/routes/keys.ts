import { PublishKeysInput, RegisterDeviceInput } from '@huddle/core';
import { Hono } from 'hono';
import {
  channelDevices,
  devicesAwaitingKeys,
  fetchChannelKeys,
  publishChannelKeys,
  registerDevice,
} from '../../services/index.js';
import type { ApiEnv } from '../env.js';
import { failure, jsonBody } from '../http.js';
import { currentUser } from '../session.js';

/**
 * Devices and sealed channel keys.
 *
 * Every route here moves ciphertext the server cannot read. What it does
 * decide is who may ask for what, which is the half of the problem that
 * cryptography does not solve on its own.
 */
export function keyRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.post('/devices', async (c) => {
    const input = await jsonBody(c, RegisterDeviceInput);
    const device = await registerDevice(c.var.app, {
      userId: currentUser(c).id,
      encryptionKey: input.encryptionKey,
      signingKey: input.signingKey,
      label: input.label,
    });

    return c.json(device, 201);
  });

  /* Whose devices a channel key has to reach. */
  routes.get('/channels/:channelId/devices', async (c) => {
    const listed = await channelDevices(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
    });

    if (!listed.ok) return failure(c, listed.error);
    return c.json(listed.value);
  });

  /* The ones still waiting, so anybody holding the key can seal it for them. */
  routes.get('/channels/:channelId/keys/pending', async (c) => {
    const waiting = await devicesAwaitingKeys(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
    });

    if (!waiting.ok) return failure(c, waiting.error);
    return c.json(waiting.value);
  });

  routes.get('/channels/:channelId/keys', async (c) => {
    const keys = await fetchChannelKeys(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      deviceId: c.req.query('deviceId') ?? '',
    });

    if (!keys.ok) return failure(c, keys.error);
    return c.json(keys.value);
  });

  routes.post('/channels/:channelId/keys', async (c) => {
    const input = await jsonBody(c, PublishKeysInput);
    const stored = await publishChannelKeys(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      epoch: input.epoch,
      sealedBy: input.sealedBy,
      entries: input.entries,
    });

    if (!stored.ok) return failure(c, stored.error);
    return c.json({ stored: stored.value }, 201);
  });

  return routes;
}
