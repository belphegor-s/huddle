import type { ChannelSummary, NotificationLevel } from '@huddle/core';
import { Button, cx, Icon, TextField } from '@huddle/ui';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useDismiss } from '../lib/use-dismiss';
import { Dialog } from './dialog';

interface ChannelMenuProps {
  summary: ChannelSummary;
  workspaceSlug: string;
  /** Admins, and whoever made the channel. Matches the rule on the server. */
  canManage: boolean;
  onChanged(): void;
}

const LEVELS: Array<{ value: NotificationLevel; label: string; hint: string }> = [
  { value: 'all', label: 'Every message', hint: 'The default' },
  { value: 'mentions', label: 'Only mentions', hint: 'When someone names you' },
  { value: 'none', label: 'Nothing', hint: 'No notifications at all' },
];

const MUTES = [
  { label: 'For an hour', ms: 60 * 60 * 1000 },
  { label: 'For eight hours', ms: 8 * 60 * 60 * 1000 },
  { label: 'For a week', ms: 7 * 24 * 60 * 60 * 1000 },
];

export function ChannelMenu({ summary, workspaceSlug, canManage, onChanged }: ChannelMenuProps) {
  const [topic, setTopic] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useDismiss(panel, () => setOpen(false));

  const channelId = summary.channel.id;

  async function save(patch: {
    notificationLevel?: NotificationLevel;
    mutedUntil?: number | null;
  }) {
    await api.setChannelPrefs(channelId, patch);
    onChanged();
  }

  async function archive() {
    // Archiving hides it from every sidebar, so whoever did it should not be
    // left staring at a channel that no longer exists for anyone.
    await api.updateChannel(channelId, { archived: true });
    setOpen(false);
    onChanged();
    await navigate(`/w/${workspaceSlug}`);
  }

  async function saveTopic(next: string) {
    await api.updateChannel(channelId, { topic: next.trim() === '' ? null : next.trim() });
    setTopic(null);
    setOpen(false);
    onChanged();
  }

  async function leave() {
    await api.leaveChannel(channelId);
    setOpen(false);
    onChanged();
    await navigate(`/w/${workspaceSlug}`);
  }

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          summary.channel.kind === 'channel' ? 'Channel settings' : 'Conversation settings'
        }
        className="text-text-secondary hover:bg-surface-hover grid size-9 place-items-center rounded-lg"
      >
        <Icon name={summary.muted ? 'bell' : 'more'} className="size-4" />
      </button>

      {open ? (
        <div
          role="menu"
          className="border-border bg-surface-raised shadow-popover absolute top-11 right-0 z-30 flex w-64 flex-col rounded-xl border p-1"
        >
          <p className="text-text-muted text-2xs px-2 pt-2 pb-1 font-semibold tracking-wide uppercase">
            Notify me about
          </p>

          {LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              role="menuitemradio"
              aria-checked={summary.notificationLevel === level.value}
              onClick={() => void save({ notificationLevel: level.value })}
              className={cx(
                'flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm',
                summary.notificationLevel === level.value
                  ? 'bg-surface-active'
                  : 'hover:bg-surface-hover',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{level.label}</span>
                <span className="text-text-muted block truncate text-xs">{level.hint}</span>
              </span>
              {summary.notificationLevel === level.value ? (
                <Icon name="check" className="text-accent size-4" />
              ) : null}
            </button>
          ))}

          <p className="border-border text-text-muted text-2xs mt-1 border-t px-2 pt-2 pb-1 font-semibold tracking-wide uppercase">
            Mute
          </p>

          {summary.muted ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void save({ mutedUntil: null })}
              className="hover:bg-surface-hover flex min-h-11 items-center rounded-lg px-2 text-left text-sm"
            >
              Unmute
            </button>
          ) : (
            MUTES.map((mute) => (
              <button
                key={mute.label}
                type="button"
                role="menuitem"
                onClick={() => void save({ mutedUntil: Date.now() + mute.ms })}
                className="hover:bg-surface-hover flex min-h-11 items-center rounded-lg px-2 text-left text-sm"
              >
                {mute.label}
              </button>
            ))
          )}

          {canManage && summary.channel.kind === 'channel' ? (
            <>
              <p className="border-border text-text-muted text-2xs mt-1 border-t px-2 pt-2 pb-1 font-semibold tracking-wide uppercase">
                Channel
              </p>

              <button
                type="button"
                role="menuitem"
                onClick={() => setTopic(summary.channel.topic ?? '')}
                className="hover:bg-surface-hover flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm"
              >
                <Icon name="edit" className="size-4" />
                {summary.channel.topic ? 'Edit the topic' : 'Add a topic'}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => void archive()}
                className="hover:bg-surface-hover flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm"
              >
                <Icon name="file" className="size-4" />
                Archive channel
              </button>
            </>
          ) : null}

          <button
            type="button"
            role="menuitem"
            onClick={() => void leave()}
            className="text-critical border-border hover:bg-surface-hover mt-1 flex min-h-11 items-center gap-2 rounded-lg border-t px-2 text-left text-sm"
          >
            <Icon name="close" className="size-4" />
            {summary.channel.kind === 'channel' ? 'Leave channel' : 'Close conversation'}
          </button>
        </div>
      ) : null}

      {topic === null ? null : (
        <Dialog
          title={summary.channel.topic ? 'Edit the topic' : 'Add a topic'}
          onClose={() => setTopic(null)}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTopic(topic);
            }}
          >
            <TextField
              label="Topic"
              value={topic}
              autoFocus
              maxLength={280}
              onChange={(event) => setTopic(event.target.value)}
              hint="What this channel is for. Shown under its name."
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setTopic(null)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
