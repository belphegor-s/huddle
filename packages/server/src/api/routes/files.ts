import { CreateUploadInput } from '@huddle/core';
import { Hono } from 'hono';
import { deleteFile, requestUpload, resolveDownload, unfurlLink } from '../../services/index.js';
import type { ApiEnv } from '../env.js';
import { failure, jsonBody } from '../http.js';
import { currentUser } from '../session.js';

export function fileRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.post('/workspaces/:workspaceId/uploads', async (c) => {
    const input = await jsonBody(c, CreateUploadInput);
    const ticket = await requestUpload(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
      ...input,
    });

    if (!ticket.ok) return failure(c, ticket.error);
    return c.json(ticket.value, 201);
  });

  /*
   * A redirect rather than a proxy. The bytes go from the bucket to the
   * browser, so an attachment never occupies this process, and the permanent
   * message link keeps working after the signed URL it points at has expired.
   */
  routes.get('/files/:fileId', async (c) => {
    const url = await resolveDownload(c.var.app, {
      fileId: c.req.param('fileId'),
      userId: currentUser(c).id,
    });

    if (!url.ok) return failure(c, url.error);
    return c.redirect(url.value, 302);
  });

  /*
   * The client never fetches a linked page itself. It asks here, and the
   * server reads the page and mirrors any preview image into this bucket, so
   * a rendered message makes no request to anyone else.
   */
  routes.get('/workspaces/:workspaceId/unfurl', async (c) => {
    const url = c.req.query('url');
    if (url === undefined) return failure(c, 'invalid');

    const preview = await unfurlLink(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      userId: currentUser(c).id,
      url,
    });

    if (!preview.ok) return failure(c, preview.error);
    return c.json(preview.value, 200, {
      // Already cached on the server. This stops a re-render refetching it.
      'cache-control': 'private, max-age=300',
    });
  });

  routes.delete('/files/:fileId', async (c) => {
    const removed = await deleteFile(c.var.app, {
      fileId: c.req.param('fileId'),
      userId: currentUser(c).id,
    });

    if (!removed.ok) return failure(c, removed.error);
    return c.json({ ok: true });
  });

  return routes;
}
