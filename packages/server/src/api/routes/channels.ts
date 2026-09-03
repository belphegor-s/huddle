import {
  CreateChannelInput,
  OpenDmInput,
  SearchInput,
  UpdateChannelInput,
  UpdateChannelPrefsInput,
} from '@huddle/core';
import { Hono } from 'hono';
import {
  browseChannels,
  createChannel,
  findChannelByRef,
  joinChannel,
  leaveChannel,
  listChannels,
  listMembers,
  openDm,
  requireChannel,
  searchMessages,
  setChannelPrefs,
  updateChannel,
} from '../../services/index.js';
import type { ApiEnv } from '../env.js';
import { failure, jsonBody } from '../http.js';
import { currentUser } from '../session.js';

export function channelRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.get('/workspaces/:workspaceId/channels', async (c) => {
    const list = await listChannels(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
    });

    if (!list.ok) return failure(c, list.error);
    return c.json(list.value);
  });

  routes.get('/workspaces/:workspaceId/channels/browse', async (c) => {
    const list = await browseChannels(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
    });

    if (!list.ok) return failure(c, list.error);
    return c.json(list.value);
  });

  routes.post('/workspaces/:workspaceId/channels', async (c) => {
    const input = await jsonBody(c, CreateChannelInput);
    const created = await createChannel(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
      ...input,
    });

    if (!created.ok) return failure(c, created.error);
    return c.json(created.value, 201);
  });

  routes.post('/workspaces/:workspaceId/dms', async (c) => {
    const input = await jsonBody(c, OpenDmInput);
    const opened = await openDm(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
      userIds: input.userIds,
    });

    if (!opened.ok) return failure(c, opened.error);
    return c.json(opened.value);
  });

  routes.get('/workspaces/:workspaceId/members', async (c) => {
    const members = await listMembers(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
    });

    if (!members.ok) return failure(c, members.error);
    return c.json(members.value);
  });

  routes.get('/workspaces/:workspaceId/search', async (c) => {
    const files = c.req.query('files');
    const query = SearchInput.safeParse({
      text: c.req.query('q') ?? '',
      channelId: c.req.query('channel'),
      authorId: c.req.query('author'),
      hasFile: files === undefined ? undefined : files === 'true',
      limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')),
    });
    if (!query.success) return failure(c, 'invalid');

    const found = await searchMessages(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
      query: query.data,
    });

    if (!found.ok) return failure(c, found.error);
    return c.json(found.value);
  });

  /*
   * A link to a channel carries its name, and the person following it may not
   * be in it yet. The sidebar only lists channels you have joined, so this is
   * how the client resolves everything else it is allowed to see.
   */
  routes.get('/workspaces/:workspaceId/channels/by-ref/:ref', async (c) => {
    const access = await findChannelByRef(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
      ref: c.req.param('ref'),
    });

    if (!access.ok) return failure(c, access.error);
    return c.json(access.value);
  });

  routes.get('/channels/:channelId', async (c) => {
    const access = await requireChannel(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
    });

    if (!access.ok) return failure(c, access.error);
    return c.json(access.value);
  });

  routes.patch('/channels/:channelId', async (c) => {
    const patch = await jsonBody(c, UpdateChannelInput);
    const updated = await updateChannel(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      patch,
    });

    if (!updated.ok) return failure(c, updated.error);
    return c.json(updated.value);
  });

  routes.post('/channels/:channelId/join', async (c) => {
    const joined = await joinChannel(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
    });

    if (!joined.ok) return failure(c, joined.error);
    return c.json(joined.value);
  });

  routes.delete('/channels/:channelId/members/me', async (c) => {
    const left = await leaveChannel(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
    });

    if (!left.ok) return failure(c, left.error);
    return c.json({ ok: true });
  });

  routes.patch('/channels/:channelId/prefs', async (c) => {
    const patch = await jsonBody(c, UpdateChannelPrefsInput);
    const saved = await setChannelPrefs(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      patch,
    });

    if (!saved.ok) return failure(c, saved.error);
    return c.json({ ok: true });
  });

  return routes;
}
