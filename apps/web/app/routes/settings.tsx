import { UpdateWorkspaceInput } from '@huddle/core';
import { Button, Icon, TextField } from '@huddle/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { outranksMember } from '../lib/roles';
import { useWorkspace } from '../lib/workspace';

/**
 * What a workspace is called and what it looks like. The address is shown but
 * not editable: every invite link and every bookmark anybody holds carries it,
 * and quietly breaking those is worse than living with a name chosen in a
 * hurry.
 */
export default function WorkspaceSettings() {
  const { workspace, role, refresh } = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const clean = name.trim();
  const changed = clean !== workspace.name;
  const canManage = outranksMember(role, 'admin');

  async function save() {
    if (!changed || clean === '') return;

    setSaving(true);
    setProblem(null);

    try {
      await api.updateWorkspace(workspace.id, UpdateWorkspaceInput.parse({ name: clean }));
      setSaved(true);
      refresh();
    } catch {
      setProblem('That did not save. Try again in a moment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col gap-6 overflow-y-auto px-4 py-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="flex items-center gap-3">
        <Link
          to={`/w/${workspace.slug}`}
          aria-label="Back to conversations"
          className="text-text-secondary hover:bg-surface-hover -ml-1 grid size-9 place-items-center rounded-lg no-underline md:hidden"
        >
          <Icon name="chevronLeft" className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Workspace</h1>
          <p className="text-text-muted text-sm">Settings for {workspace.name}</p>
        </div>
      </header>

      {canManage ? null : (
        <p className="border-border bg-surface-raised text-text-secondary rounded-lg border px-3 py-2 text-sm">
          Only an admin can change these.
        </p>
      )}

      <TextField
        label="Name"
        value={name}
        maxLength={80}
        disabled={!canManage}
        onChange={(event) => {
          setName(event.target.value);
          setSaved(false);
        }}
        hint="What people see at the top of the sidebar"
        error={problem}
      />

      <TextField
        label="Address"
        value={`${window.location.origin}/w/${workspace.slug}`}
        readOnly
        disabled
        hint="Fixed, because every invite link already sent points at it"
      />

      {canManage ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving || !changed || clean === ''}>
            {saving ? 'Saving' : 'Save'}
          </Button>
          {saved && !changed ? (
            <span className="text-text-muted flex items-center gap-1 text-sm">
              <Icon name="check" className="text-accent size-4" />
              Saved
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="border-border flex flex-col gap-2 border-t pt-4">
        <h2 className="text-text-muted text-2xs font-semibold tracking-wide uppercase">People</h2>
        <p className="text-text-muted text-sm">
          Roles and invitations live with the people who hold them.
        </p>
        <Link
          to={`/w/${workspace.slug}/people`}
          className="border-border bg-surface-raised hover:bg-surface-hover flex min-h-11 w-fit items-center gap-2 rounded-lg border px-3 text-sm no-underline"
        >
          <Icon name="people" className="size-4" />
          Manage people
        </Link>
      </section>
    </form>
  );
}
