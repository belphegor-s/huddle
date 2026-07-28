import { CreateInviteInput } from '@huddle/core';
import { createInvite, findWorkspaceBySlug, listWorkspaces, outranks } from '@huddle/domain';
import { Avatar, Button } from '@huddle/ui';
import { data, Form, Link, useNavigation } from 'react-router';
import { requireUser } from '../lib/session.server';
import { portsContext } from '../lib/ports';
import type { Route } from './+types/workspace';

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.workspace.name ?? 'huddle' }];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const user = await requireUser(context, request);
  const found = await findWorkspaceBySlug(context.get(portsContext), {
    slug: params.slug,
    userId: user.id,
  });

  // A workspace someone is not in is indistinguishable from one that does not
  // exist, both here and in the API.
  if (!found.ok) throw data('Not found', { status: 404 });

  return {
    user,
    workspace: found.value.workspace,
    role: found.value.role,
    workspaces: await listWorkspaces(context.get(portsContext), user.id),
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const user = await requireUser(context, request);
  const found = await findWorkspaceBySlug(context.get(portsContext), {
    slug: params.slug,
    userId: user.id,
  });
  if (!found.ok) throw data('Not found', { status: 404 });

  const invite = await createInvite(context.get(portsContext), {
    workspaceId: found.value.workspace.id,
    actorId: user.id,
    ...CreateInviteInput.parse({}),
  });

  if (!invite.ok) return { inviteUrl: null };

  return { inviteUrl: `${new URL(request.url).origin}/join/${invite.value.token}` };
}

export default function WorkspaceHome({ loaderData, actionData }: Route.ComponentProps) {
  const { user, workspace, role, workspaces } = loaderData;
  const navigation = useNavigation();
  const canInvite = outranks(role, 'admin');

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <nav className="border-border bg-surface-sunken flex items-center justify-between gap-3 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:w-64 md:flex-col md:items-stretch md:border-r md:border-b-0 md:py-4">
        <div className="flex items-center gap-2">
          <Avatar name={workspace.name} size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium">{workspace.name}</p>
            <p className="text-text-muted truncate text-xs">{role}</p>
          </div>
        </div>

        {workspaces.length > 1 ? (
          <ul className="hidden gap-1 md:mt-6 md:flex md:flex-col">
            {workspaces.map(({ workspace: other }) => (
              <li key={other.id}>
                <Link
                  to={`/w/${other.slug}`}
                  className={
                    other.id === workspace.id
                      ? 'bg-surface-active flex min-h-11 items-center rounded-lg px-3 text-sm no-underline'
                      : 'text-text-secondary hover:bg-surface-hover flex min-h-11 items-center rounded-lg px-3 text-sm no-underline'
                  }
                >
                  {other.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-2 md:mt-auto">
          <Avatar name={user.displayName} url={user.avatarUrl} size="md" />
          <span className="hidden min-w-0 flex-1 truncate text-sm md:block">
            {user.displayName}
          </span>
          <Form method="post" action="/signout">
            <Button type="submit" variant="ghost">
              Sign out
            </Button>
          </Form>
        </div>
      </nav>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <div className="flex max-w-sm flex-col gap-2">
          <h1 className="text-2xl">No channels yet</h1>
          <p className="text-text-secondary">
            Channels, threads and messages arrive next. For now, get the rest of the team in.
          </p>
        </div>

        {canInvite ? (
          <div className="flex w-full max-w-md flex-col gap-3">
            <Form method="post">
              <Button type="submit" disabled={navigation.state === 'submitting'}>
                {navigation.state === 'submitting' ? 'Creating link' : 'Create an invite link'}
              </Button>
            </Form>

            {actionData?.inviteUrl ? (
              <output className="border-border bg-surface-raised rounded-lg border px-3 py-2 text-left font-mono text-xs break-all">
                {actionData.inviteUrl}
              </output>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
