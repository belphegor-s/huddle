import type { Me, Presence } from '@huddle/core';
import { Avatar, cx, Icon, Menu, MenuButton, MenuItem, MenuLabel, MenuSeparator } from '@huddle/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { PRESENCE_CHOICES, presenceOf, statusLine } from '../lib/presence';

interface StatusMenuProps {
  me: Me;
  workspaceSlug: string;
  /** In the rail there is no room for a name, only the face. */
  compact?: boolean;
  onChanged(): void;
}

/**
 * Who you are, how you appear, and the way out.
 *
 * All three live together because they are the same question to a person
 * looking at their own name in the corner, and because sign out belongs
 * somewhere deliberate rather than one stray click from the message you are
 * writing.
 */
export function StatusMenu({ me, workspaceSlug, compact = false, onChanged }: StatusMenuProps) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const self = {
    id: me.user.id,
    displayName: me.user.displayName,
    avatarUrl: me.user.avatarUrl,
    role: 'member' as const,
    presence: me.user.presence,
    statusEmoji: me.user.statusEmoji,
    statusText: me.user.statusText,
    // Looking at your own menu is proof enough that you are here.
    online: true,
  };

  async function choose(presence: Presence) {
    await api.updateProfile({ presence });
    onChanged();
  }

  async function clearStatus() {
    await api.updateProfile({ statusEmoji: null, statusText: null });
    onChanged();
  }

  const line = statusLine(self);

  return (
    <>
      <Menu
        label="Your status"
        align="start"
        side="top"
        // Same width as the row it hangs from, so it lines up with the
        // sidebar's padding rather than sitting near it.
        matchTrigger={!compact}
        className={compact ? 'min-w-56' : ''}
        trigger={
          <MenuButton
            title={me.user.displayName}
            className={cx(
              'hover:bg-surface-hover flex w-full min-w-0 items-center gap-2 rounded-lg py-1 text-left',
              compact ? 'md:justify-center md:px-0' : 'px-2',
            )}
          >
            <Avatar
              name={me.user.displayName}
              url={me.user.avatarUrl}
              size="md"
              presence={presenceOf(self)}
            />
            <span className={cx('min-w-0 flex-1', compact && 'md:sr-only')}>
              <span className="text-text-primary block truncate text-sm">
                {me.user.displayName}
              </span>
              {line ? <span className="text-text-muted block truncate text-xs">{line}</span> : null}
            </span>
            {/*
              Up and down rather than down alone. This row is at the foot of
              the sidebar and its menu opens upward, so a chevron pointing at
              the floor was pointing away from where the menu appears.
            */}
            <Icon
              name="chevronsUpDown"
              className={cx('text-text-muted size-4 shrink-0', compact && 'md:hidden')}
            />
          </MenuButton>
        }
      >
        <>
          <MenuLabel>Appear as</MenuLabel>
          {PRESENCE_CHOICES.map((choice) => (
            <MenuItem
              key={choice.value}
              selected={me.user.presence === choice.value}
              // What invisible actually does is worth saying, rather than
              // leaving somebody to find out by being invisible.
              description={choice.hint}
              onSelect={() => void choose(choice.value)}
            >
              {choice.label}
            </MenuItem>
          ))}

          <MenuSeparator />

          <MenuItem icon="emoji" onSelect={() => setEditing(true)}>
            {line ? 'Change your status' : 'Set a status'}
          </MenuItem>
          {line ? (
            <MenuItem icon="close" onSelect={() => void clearStatus()}>
              Clear your status
            </MenuItem>
          ) : null}

          <MenuSeparator />

          <MenuItem icon="people" onSelect={() => void navigate(`/w/${workspaceSlug}/you`)}>
            Profile
          </MenuItem>
          <MenuItem icon="trash" danger onSelect={() => void navigate('/signout')}>
            Sign out
          </MenuItem>
        </>
      </Menu>

      {editing ? (
        <StatusDialog
          emoji={me.user.statusEmoji}
          text={me.user.statusText}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            await api.updateProfile(next);
            setEditing(false);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/** A few that cover most of what anybody actually sets. */
const SUGGESTED = ['💬', '🎧', '🍜', '🌴', '🤒', '🚌', '📵'];

function StatusDialog({
  emoji,
  text,
  onClose,
  onSave,
}: {
  emoji: string | null;
  text: string | null;
  onClose(): void;
  onSave(next: { statusEmoji: string | null; statusText: string | null }): Promise<void>;
}) {
  const [pickedEmoji, setEmoji] = useState(emoji ?? '');
  const [message, setMessage] = useState(text ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        statusEmoji: pickedEmoji.trim() === '' ? null : pickedEmoji.trim(),
        statusText: message.trim() === '' ? null : message.trim(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set a status"
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-raised border-border w-full max-w-sm rounded-2xl border p-4 shadow-lg">
        <h2 className="text-base font-semibold">Set a status</h2>

        <div className="mt-3 flex items-center gap-2">
          <input
            aria-label="Status emoji"
            value={pickedEmoji}
            onChange={(event) => setEmoji(event.target.value)}
            maxLength={4}
            className="border-border bg-surface size-11 shrink-0 rounded-lg border text-center text-lg"
          />
          <input
            aria-label="Status message"
            value={message}
            placeholder="What is happening"
            maxLength={80}
            autoFocus
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
              if (event.key === 'Escape') onClose();
            }}
            className="border-border bg-surface min-h-11 flex-1 rounded-lg border px-3 text-sm"
          />
        </div>

        <ul className="mt-3 flex flex-wrap gap-1">
          {SUGGESTED.map((one) => (
            <li key={one}>
              <button
                type="button"
                aria-label={`Use ${one}`}
                onClick={() => setEmoji(one)}
                className="hover:bg-surface-hover grid size-9 place-items-center rounded-lg text-lg"
              >
                {one}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:bg-surface-hover min-h-10 rounded-lg px-3 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="bg-accent text-on-accent hover:bg-accent-hover min-h-10 rounded-lg px-4 text-sm font-medium disabled:opacity-60"
          >
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
