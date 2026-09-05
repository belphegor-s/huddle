import { CreateChannelInput } from '@huddle/core';
import { Button, cx } from '@huddle/ui';
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
import { CallDock } from '../components/call-dock';
import { ConnectionBanner } from '../components/connection-banner';
import { Sidebar } from '../components/sidebar';
import { api, ApiError } from '../lib/api';
import { CallSession } from '../lib/call';
import { deviceIdentity } from '../lib/device';
import { shareOrCreateKeyring, shareWithWaitingDevices } from '../lib/keyring';
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

  const [channels, members, features, discoverable] = await Promise.all([
    api.channels(found.workspace.id),
    api.members(found.workspace.id),
    api.capabilities(),
    // Public channels this person has not joined. Without these the sidebar
    // shows only what somebody was added to, and a workspace full of open
    // channels looks empty.
    api.browseChannels(found.workspace.id).catch(() => []),
  ]);

  return {
    me,
    workspace: found.workspace,
    role: found.role,
    channels,
    members,
    features,
    discoverable,
  };
}

export default function WorkspaceLayout({ loaderData }: Route.ComponentProps) {
  const { me, workspace, role, channels, members, features, discoverable } = loaderData;
  const revalidator = useRevalidator();
  const params = useParams();
  const location = useLocation();
  const [dialog, setDialog] = useState<'channel' | 'dm' | null>(null);

  // One socket for the whole session, kept across channel and workspace
  // navigations, because the connection is per person and the subscriptions on
  // it are per channel. Switching rooms never costs a reconnect.
  const [realtime] = useState(() => new Realtime());

  // The call belongs to the session, not to the screen. Walking from the
  // huddle to another channel to paste a link must not hang up on everybody.
  const [call] = useState(() => new CallSession(realtime));

  // Registered as soon as somebody is signed in, because a device nobody
  // knows about is a device no channel key can be sealed to.
  useEffect(() => {
    void deviceIdentity().catch(() => undefined);
  }, []);

  useEffect(() => {
    realtime.connect();
    return () => {
      call.leave();
      realtime.stop();
    };
  }, [call, realtime]);

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
  /*
   * Somebody in a channel this browser has a key for cannot read it yet. The
   * server cannot help, so whoever holds the key answers. This listens across
   * the whole workspace rather than only the open channel: the person waiting
   * is usually not the one being looked at.
   */
  useEffect(() => {
    return realtime.on((event) => {
      if (event.type !== 'keys_needed') return;
      void shareWithWaitingDevices(event.channelId, event.epoch).catch(() => undefined);
    });
  }, [realtime]);

  useEffect(() => {
    return realtime.on((event) => {
      if (event.type === 'unread' && event.channelId !== params.ref) refresh();
      if (event.type === 'call_activity') refresh();
      // A channel was made, joined, left, renamed, archived or deleted. What
      // moved is the list, so the list is what gets read again.
      if (event.type === 'channels_changed' && event.workspaceId === workspace.id) refresh();
    });
  }, [params.ref, realtime, refresh, workspace.id]);

  const context: WorkspaceContext = {
    me,
    workspace,
    role,
    members,
    channels,
    realtime,
    call,
    features,
    refresh,
  };

  // On a phone the sidebar and the conversation are two screens, not a drawer:
  // a first time user must never have to discover a swipe to find either.
  const inRoom = location.pathname !== `/w/${workspace.slug}`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <ConnectionBanner realtime={realtime} />
      <CallDock call={call} workspaceSlug={workspace.slug} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          me={me}
          workspace={workspace}
          role={role}
          channels={channels}
          members={members}
          discoverable={discoverable}
          className={cx(inRoom ? 'hidden md:flex' : 'flex')}
          onCreateChannel={() => setDialog('channel')}
          onStartDm={() => setDialog('dm')}
          onChanged={refresh}
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

            // The first key, sealed to whoever is already in the channel. Every
            // later member gets it from somebody who has it: the server cannot
            // help, because it has nothing to seal.
            if (created.channel.encrypted) {
              await shareOrCreateKeyring(created.channel.id, created.channel.keyEpoch);
            }

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

            // A conversation is encrypted from the start, so it needs a key
            // before the first message rather than after it.
            if (opened.channel.encrypted) {
              await shareOrCreateKeyring(opened.channel.id, opened.channel.keyEpoch);
            }

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
          : 'The connection dropped or the server could not be reached.'}
      </p>

      {/*
        A way back in, not just a way out. A phone loses the network for a
        second at a time, and the screen this replaces is usually one press
        away from working again.
      */}
      {missing ? null : (
        <Button type="button" className="w-fit" onClick={() => window.location.reload()}>
          Try again
        </Button>
      )}

      <Link to="/" className="text-accent text-sm">
        Go to your workspaces
      </Link>
    </main>
  );
}
