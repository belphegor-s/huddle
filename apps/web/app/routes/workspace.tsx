import { CreateChannelInput } from '@huddle/core';
import { cx } from '@huddle/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  isRouteErrorResponse,
  Link,
  Outlet,
  useLocation,
  useParams,
  useRevalidator,
} from 'react-router';
import { NewChannelDialog } from '../components/new-channel-dialog';
import { NewDmDialog } from '../components/new-dm-dialog';
import { ConnectionBanner } from '../components/connection-banner';
import { Sidebar } from '../components/sidebar';
import { api, ApiError } from '../lib/api';
import { Realtime } from '../lib/realtime';
import { requireMe } from '../lib/session';
import type { WorkspaceContext } from '../lib/workspace';
import type { Route } from './+types/workspace';

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.workspace.name ?? 'huddle' }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const me = await requireMe();
  const slug = params.slug ?? '';
  const found = await api.workspaceBySlug(slug);

  const [channels, members, features] = await Promise.all([
    api.channels(found.workspace.id),
    api.members(found.workspace.id),
    api.capabilities(),
  ]);

  return { me, workspace: found.workspace, role: found.role, channels, members, features };
}

export default function WorkspaceLayout({ loaderData }: Route.ComponentProps) {
  const { me, workspace, role, channels, members, features } = loaderData;
  const revalidator = useRevalidator();
  const params = useParams();
  const location = useLocation();
  const [dialog, setDialog] = useState<'channel' | 'dm' | null>(null);

  // One socket for the whole session, kept across channel and workspace
  // navigations, because the connection is per person and the subscriptions on
  // it are per channel. Switching rooms never costs a reconnect.
  const [realtime] = useState(() => new Realtime());

  useEffect(() => {
    realtime.connect();
    return () => realtime.stop();
  }, [realtime]);

  const refresh = useCallback(() => {
    void revalidator.revalidate();
  }, [revalidator]);

  /*
   * The server sends an unread count straight to each member, because the
   * channel fanout only reaches sockets subscribed to that channel and a badge
   * has to move for the channels you are not looking at. The sidebar re-reads
   * rather than trusting the number, so one revalidation settles every badge at
   * once however many arrived.
   */
  useEffect(() => {
    return realtime.on((event) => {
      if (event.type === 'unread' && event.channelId !== params.ref) refresh();
    });
  }, [params.ref, realtime, refresh]);

  const context: WorkspaceContext = {
    me,
    workspace,
    role,
    members,
    channels,
    realtime,
    features,
    refresh,
  };

  // On a phone the sidebar and the conversation are two screens, not a drawer:
  // a first time user must never have to discover a swipe to find either.
  const inRoom = location.pathname !== `/w/${workspace.slug}`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <ConnectionBanner realtime={realtime} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          me={me}
          workspace={workspace}
          channels={channels}
          members={members}
          className={cx(inRoom ? 'hidden md:flex' : 'flex')}
          onCreateChannel={() => setDialog('channel')}
          onStartDm={() => setDialog('dm')}
        />

        <main className={cx('min-w-0 flex-1', inRoom ? 'flex' : 'hidden md:flex')}>
          <Outlet context={context} />
        </main>
      </div>

      {dialog === 'channel' ? (
        <NewChannelDialog
          workspaceSlug={workspace.slug}
          onClose={() => setDialog(null)}
          onCreate={async (input) => {
            const created = await api.createChannel(workspace.id, CreateChannelInput.parse(input));
            setDialog(null);
            refresh();
            return created;
          }}
        />
      ) : null}

      {dialog === 'dm' ? (
        <NewDmDialog
          workspaceSlug={workspace.slug}
          members={members.filter((member) => member.id !== me.user.id)}
          onClose={() => setDialog(null)}
          onOpen={async (userIds) => {
            const opened = await api.openDm(workspace.id, userIds);
            setDialog(null);
            refresh();
            return opened;
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A route level boundary, so a workspace that cannot load leaves the rest of
 * the app standing rather than replacing the whole page with the root error.
 * The most likely cause by far is a link to a workspace you are not in, and
 * that answers 404 on purpose.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const missing =
    (error instanceof ApiError && error.status === 404) ||
    (isRouteErrorResponse(error) && error.status === 404);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl">{missing ? 'Workspace not found' : 'That did not load'}</h1>
      <p className="text-text-secondary text-sm">
        {missing
          ? 'It may have been deleted, or you may not be a member of it.'
          : 'The connection dropped or the server is unreachable. Reloading usually fixes it.'}
      </p>
      <Link to="/" className="text-accent text-sm">
        Go to your workspaces
      </Link>
    </main>
  );
}
