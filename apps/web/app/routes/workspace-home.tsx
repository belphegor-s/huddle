import type { Channel } from '@huddle/core';
import { Button } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { outranksMember } from '../lib/roles';
import { useWorkspace } from '../lib/workspace';

/**
 * The workspace landing screen. On a phone this is the channel list itself, so
 * the only thing shown here is what the sidebar does not already cover: what
 * to join next, and how to get the rest of the team in.
 */
export default function WorkspaceHome() {
  const { workspace, role, channels, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [browsable, setBrowsable] = useState<Channel[]>([]);

  useEffect(() => {
    void api
      .browseChannels(workspace.id)
      .then(setBrowsable)
      .catch(() => setBrowsable([]));
  }, [workspace.id, channels.length]);

  async function join(channel: Channel) {
    await api.joinChannel(channel.id);
    refresh();
    await navigate(`/w/${workspace.slug}/c/${channel.name ?? channel.id}`);
  }

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-8 overflow-y-auto px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{workspace.name}</h1>
        <p className="text-text-secondary text-sm">
          {channels.length === 0
            ? 'Nothing here yet. Make a channel or get the team in.'
            : 'Pick a conversation on the left, or join something new.'}
        </p>
      </header>

      {browsable.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-text-muted text-2xs font-semibold tracking-wide uppercase">
            Channels you are not in
          </h2>
          <ul className="flex flex-col gap-2">
            {browsable.map((channel) => (
              <li
                key={channel.id}
                className="border-border bg-surface-raised flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">#{channel.name}</p>
                  {channel.topic ? (
                    <p className="text-text-muted truncate text-xs">{channel.topic}</p>
                  ) : null}
                </div>
                <Button variant="secondary" onClick={() => void join(channel)}>
                  Join
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {outranksMember(role, 'admin') ? (
        <Link to={`/w/${workspace.slug}/people`} className="text-accent text-sm">
          Invite people to {workspace.name}
        </Link>
      ) : null}

      <Link to={`/w/${workspace.slug}/search`} className="text-accent text-sm">
        Search every message you can read
      </Link>
    </section>
  );
}
