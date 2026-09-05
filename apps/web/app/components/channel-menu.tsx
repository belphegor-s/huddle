import type { ChannelSummary, NotificationLevel } from '@huddle/core';
import {
  Button,
  Icon,
  Menu,
  MenuButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  TextField,
} from '@huddle/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useConfirm } from './confirm';
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
  const { confirm, dialog } = useConfirm();
  const isChannel = summary.channel.kind === 'channel';
  const navigate = useNavigate();

  const channelId = summary.channel.id;
  const archived = summary.channel.archivedAt !== null;

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
    onChanged();
    await navigate(`/w/${workspaceSlug}`);
  }

  async function restore() {
    await api.updateChannel(channelId, { archived: false });
    onChanged();
  }

  async function remove() {
    await api.deleteChannel(channelId);
    onChanged();
    await navigate(`/w/${workspaceSlug}`);
  }

  async function saveTopic(next: string) {
    await api.updateChannel(channelId, { topic: next.trim() === '' ? null : next.trim() });
    setTopic(null);
    onChanged();
  }

  async function leave() {
    await api.leaveChannel(channelId);
    onChanged();
    await navigate(`/w/${workspaceSlug}`);
  }

  return (
    <>
      <Menu
        label={summary.channel.kind === 'channel' ? 'Channel settings' : 'Conversation settings'}
        align="end"
        className="w-64"
        trigger={
          <MenuButton
            aria-label={
              summary.channel.kind === 'channel' ? 'Channel settings' : 'Conversation settings'
            }
            className="text-text-secondary hover:bg-surface-hover grid size-9 place-items-center rounded-lg"
          >
            <Icon name={summary.muted ? 'bell' : 'more'} className="size-4" />
          </MenuButton>
        }
      >
        <>
          <MenuLabel>Notify me about</MenuLabel>
          {LEVELS.map((level) => (
            <MenuItem
              key={level.value}
              selected={summary.notificationLevel === level.value}
              description={level.hint}
              onSelect={() => void save({ notificationLevel: level.value })}
            >
              {level.label}
            </MenuItem>
          ))}

          <MenuSeparator />
          <MenuLabel>Mute</MenuLabel>

          {summary.muted ? (
            <MenuItem onSelect={() => void save({ mutedUntil: null })}>Unmute</MenuItem>
          ) : (
            MUTES.map((mute) => (
              <MenuItem
                key={mute.label}
                onSelect={() => void save({ mutedUntil: Date.now() + mute.ms })}
              >
                {mute.label}
              </MenuItem>
            ))
          )}

          {canManage && summary.channel.kind === 'channel' ? (
            <>
              <MenuSeparator />
              <MenuLabel>Channel</MenuLabel>

              <MenuItem icon="edit" onSelect={() => setTopic(summary.channel.topic ?? '')}>
                {summary.channel.topic ? 'Edit the topic' : 'Add a topic'}
              </MenuItem>

              {archived ? (
                <MenuItem icon="check" onSelect={() => void restore()}>
                  Restore channel
                </MenuItem>
              ) : (
                <MenuItem
                  icon="file"
                  onSelect={() =>
                    confirm({
                      title: 'Archive this channel',
                      body: 'It leaves every sidebar and nobody can post in it again. The messages stay readable from workspace settings, and the name is free for a new channel.',
                      action: 'Archive',
                      run: archive,
                    })
                  }
                >
                  Archive channel
                </MenuItem>
              )}

              <MenuItem
                icon="trash"
                danger
                onSelect={() =>
                  confirm({
                    title: 'Delete this channel',
                    body: 'Every message, file and reply in it goes, for everybody, and none of it can be brought back. Archiving is the one that can be undone.',
                    action: 'Delete',
                    run: remove,
                  })
                }
              >
                Delete channel
              </MenuItem>
            </>
          ) : null}

          <MenuSeparator />
          <MenuItem
            icon="close"
            danger
            onSelect={() =>
              confirm({
                title: isChannel ? 'Leave this channel' : 'Close this conversation',
                body: isChannel
                  ? summary.channel.isPrivate
                    ? 'It is private, so somebody will have to add you back.'
                    : 'You can join it again whenever you like.'
                  : 'It comes back the next time either of you writes.',
                action: isChannel ? 'Leave' : 'Close',
                run: leave,
              })
            }
          >
            {isChannel ? 'Leave channel' : 'Close conversation'}
          </MenuItem>
        </>
      </Menu>

      {dialog}

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
    </>
  );
}
