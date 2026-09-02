import { DraftMessage, EditMessageInput, MarkReadInput, ReactInput } from '@huddle/core';
import { Hono } from 'hono';
import {
  deleteMessage,
  editMessage,
  fetchHistory,
  fetchThread,
  markRead,
  markTyping,
  sendMessage,
  syncSince,
  toggleReaction,
} from '../../services/index.js';
import type { ApiEnv } from '../env.js';
import { failure, jsonBody } from '../http.js';
import { currentUser } from '../session.js';

const DEFAULT_PAGE = 50;

export function messageRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.get('/channels/:channelId/messages', async (c) => {
    const before = c.req.query('before');
    const page = await fetchHistory(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      before: before === undefined ? undefined : Number(before),
      limit: Number(c.req.query('limit') ?? DEFAULT_PAGE),
    });

    if (!page.ok) return failure(c, page.error);
    return c.json(page.value);
  });

  routes.get('/channels/:channelId/messages/since', async (c) => {
    const page = await syncSince(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      afterSeq: Number(c.req.query('seq') ?? 0),
    });

    if (!page.ok) return failure(c, page.error);
    return c.json(page.value);
  });

  routes.post('/channels/:channelId/messages', async (c) => {
    const draft = await jsonBody(c, DraftMessage);
    const sent = await sendMessage(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      draft,
    });

    if (!sent.ok) return failure(c, sent.error);
    return c.json(sent.value, 201);
  });

  routes.patch('/channels/:channelId/messages/:messageId', async (c) => {
    const input = await jsonBody(c, EditMessageInput);
    const edited = await editMessage(c.var.app, {
      channelId: c.req.param('channelId'),
      messageId: c.req.param('messageId'),
      userId: currentUser(c).id,
      ...input,
    });

    if (!edited.ok) return failure(c, edited.error);
    return c.json(edited.value);
  });

  routes.delete('/channels/:channelId/messages/:messageId', async (c) => {
    const removed = await deleteMessage(c.var.app, {
      channelId: c.req.param('channelId'),
      messageId: c.req.param('messageId'),
      userId: currentUser(c).id,
    });

    if (!removed.ok) return failure(c, removed.error);
    return c.json(removed.value);
  });

  routes.post('/channels/:channelId/messages/:messageId/reactions', async (c) => {
    const input = await jsonBody(c, ReactInput);
    const reactions = await toggleReaction(c.var.app, {
      channelId: c.req.param('channelId'),
      messageId: c.req.param('messageId'),
      userId: currentUser(c).id,
      ...input,
    });

    if (!reactions.ok) return failure(c, reactions.error);
    return c.json(reactions.value);
  });

  routes.get('/channels/:channelId/threads/:parentId', async (c) => {
    const thread = await fetchThread(c.var.app, {
      channelId: c.req.param('channelId'),
      parentId: c.req.param('parentId'),
      userId: currentUser(c).id,
      limit: Number(c.req.query('limit') ?? DEFAULT_PAGE),
    });

    if (!thread.ok) return failure(c, thread.error);
    return c.json(thread.value);
  });

  routes.post('/channels/:channelId/read', async (c) => {
    const input = await jsonBody(c, MarkReadInput);
    const read = await markRead(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
      seq: input.seq,
    });

    if (!read.ok) return failure(c, read.error);
    return c.json(read.value);
  });

  routes.post('/channels/:channelId/typing', async (c) => {
    const typing = await markTyping(c.var.app, {
      channelId: c.req.param('channelId'),
      userId: currentUser(c).id,
    });

    if (!typing.ok) return failure(c, typing.error);
    return c.json({ ok: true });
  });

  return routes;
}
