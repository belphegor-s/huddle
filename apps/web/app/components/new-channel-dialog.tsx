import type { ChannelSummary } from '@huddle/core';
import { Button, TextField } from '@huddle/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from './dialog';

interface NewChannelDialogProps {
  workspaceSlug: string;
  onClose(): void;
  onCreate(input: {
    name: string;
    topic: string | null;
    isPrivate: boolean;
  }): Promise<ChannelSummary>;
}

/** Mirrors the server rule in core, so the field cannot offer a rejected name. */
function toChannelName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 80);
}

export function NewChannelDialog({ workspaceSlug, onClose, onCreate }: NewChannelDialogProps) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const created = await onCreate({
        name,
        topic: topic.trim() === '' ? null : topic.trim(),
        isPrivate,
      });
      await navigate(`/w/${workspaceSlug}/c/${created.channel.name ?? created.channel.id}`);
    } catch {
      setError('That name is taken. Pick another one.');
      setBusy(false);
    }
  }

  return (
    <Dialog title="New channel" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(toChannelName(event.target.value))}
          autoFocus
          required
          maxLength={80}
          placeholder="launch"
          hint="Lowercase letters, numbers, hyphens and underscores."
          error={error}
        />

        <TextField
          label="Topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          maxLength={280}
          placeholder="What this channel is for"
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(event) => setPrivate(event.target.checked)}
            className="size-4"
          />
          Private, visible only to people who are added
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || name.length === 0}>
            {busy ? 'Creating' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
