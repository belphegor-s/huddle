import {
  CreateInviteInput,
  CreateWorkspaceInput,
  SetMemberRoleInput,
  UpdateProfileInput,
} from '@huddle/core';
import {
  acceptInvite,
  createInvite,
  createWorkspace,
  describeInvite,
  describeMe,
  findWorkspaceBySlug,
  listInvites,
  listWorkspaces,
  removeMember,
  revokeInvite,
  setMemberRole,
  updateProfile,
} from '../../services/index.js';
import { Hono } from 'hono';
import type { ApiEnv } from '../env.js';
import { failure, jsonBody } from '../http.js';
import { currentUser } from '../session.js';

export function workspaceRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.get('/me', async (c) => c.json(await describeMe(c.var.app, currentUser(c))));

  routes.patch('/me', async (c) => {
    const user = currentUser(c);
    const patch = await jsonBody(c, UpdateProfileInput);
    const updated = await updateProfile(c.var.app, { userId: user.id, patch });

    if (!updated) return failure(c, 'not_found');
    return c.json(updated);
  });

  routes.get('/workspaces', async (c) =>
    c.json(await listWorkspaces(c.var.app, currentUser(c).id)),
  );

  routes.post('/workspaces', async (c) => {
    const user = currentUser(c);
    const input = await jsonBody(c, CreateWorkspaceInput);
    const created = await createWorkspace(c.var.app, { userId: user.id, ...input });

    if (!created.ok) return failure(c, created.error);
    return c.json(created.value, 201);
  });

  routes.get('/workspaces/:slug', async (c) => {
    const found = await findWorkspaceBySlug(c.var.app, {
      slug: c.req.param('slug'),
      userId: currentUser(c).id,
    });

    if (!found.ok) return failure(c, found.error);
    return c.json(found.value);
  });

  routes.post('/workspaces/:workspaceId/invites', async (c) => {
    const user = currentUser(c);
    const input = await jsonBody(c, CreateInviteInput);
    const invite = await createInvite(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      actorId: user.id,
      ...input,
    });

    if (!invite.ok) return failure(c, invite.error);
    return c.json(invite.value, 201);
  });

  routes.get('/workspaces/:workspaceId/invites', async (c) => {
    const listed = await listInvites(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      actorId: currentUser(c).id,
    });

    if (!listed.ok) return failure(c, listed.error);
    return c.json(listed.value);
  });

  routes.delete('/workspaces/:workspaceId/invites/:inviteId', async (c) => {
    const revoked = await revokeInvite(c.var.app, {
      inviteId: c.req.param('inviteId'),
      workspaceId: c.req.param('workspaceId'),
      actorId: currentUser(c).id,
    });

    if (!revoked.ok) return failure(c, revoked.error);
    return c.json({ ok: true });
  });

  /*
   * Readable without a session, so the join screen can say what someone is
   * being invited to before asking them to sign in. It exposes the workspace
   * name and nothing else.
   */
  routes.patch('/workspaces/:workspaceId/members/:userId', async (c) => {
    const input = await jsonBody(c, SetMemberRoleInput);
    const updated = await setMemberRole(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      actorId: currentUser(c).id,
      userId: c.req.param('userId'),
      role: input.role,
    });

    if (!updated.ok) return failure(c, updated.error);
    return c.json(updated.value);
  });

  /*
   * The same route removes someone else and leaves yourself, because they are
   * the same operation with a different actor. Only the guard differs, and it
   * lives in the service where the rest of the rules already are.
   */
  routes.delete('/workspaces/:workspaceId/members/:userId', async (c) => {
    const removed = await removeMember(c.var.app, {
      workspaceId: c.req.param('workspaceId'),
      actorId: currentUser(c).id,
      userId: c.req.param('userId'),
    });

    if (!removed.ok) return failure(c, removed.error);
    return c.json({ ok: true });
  });

  routes.get('/invites/:token', async (c) => {
    const described = await describeInvite(c.var.app, c.req.param('token'));

    if (!described.ok) return failure(c, described.error);
    return c.json({
      workspace: { name: described.value.workspace.name, slug: described.value.workspace.slug },
      role: described.value.role,
    });
  });

  routes.post('/invites/:token/accept', async (c) => {
    const joined = await acceptInvite(c.var.app, {
      token: c.req.param('token'),
      userId: currentUser(c).id,
    });

    if (!joined.ok) return failure(c, joined.error);
    return c.json(joined.value);
  });

  return routes;
}
