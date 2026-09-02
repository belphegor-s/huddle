import type { ChannelSummary, MemberProfile } from '@huddle/core';
import { Avatar, Button, cx } from '@huddle/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from './dialog';

interface NewDmDialogProps {
  workspaceSlug: string;
  members: MemberProfile[];
  onClose(): void;
  onOpen(userIds: string[]): Promise<ChannelSummary>;
}

export function NewDmDialog({ workspaceSlug, members, onClose, onOpen }: NewDmDialogProps) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const shown = members.filter((member) =>
    member.displayName.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }

  async function start() {
    setBusy(true);
    const opened = await onOpen(selected);
    await navigate(`/w/${workspaceSlug}/c/${opened.channel.id}`);
  }

  return (
    <Dialog title="New message" onClose={onClose}>
      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Search people"
        autoFocus
        aria-label="Search people"
        className="border-border bg-surface-sunken min-h-11 rounded-lg border px-3 text-base"
      />

      <ul className="-mx-1 flex max-h-64 flex-col overflow-y-auto">
        {shown.map((member) => {
          const on = selected.includes(member.id);
          return (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => toggle(member.id)}
                aria-pressed={on}
                className={cx(
                  'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm',
                  on ? 'bg-surface-active' : 'hover:bg-surface-hover',
                )}
              >
                <Avatar name={member.displayName} url={member.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                {on ? <span className="text-accent text-xs">Selected</span> : null}
              </button>
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="text-text-muted px-3 py-3 text-sm">Nobody matches that.</li>
        ) : null}
      </ul>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={start} disabled={busy || selected.length === 0}>
          {busy ? 'Opening' : 'Start conversation'}
        </Button>
      </div>
    </Dialog>
  );
}
