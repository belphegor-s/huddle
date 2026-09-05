import type { Channel } from '@huddle/core';
import { UpdateWorkspaceInput } from '@huddle/core';
import { Button, CopyButton, Icon, Spinner, TextField } from '@huddle/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useConfirm } from '../components/confirm';
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

  const address = `${window.location.origin}/w/${workspace.slug}`;
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
        value={address}
        readOnly
        // Readable and selectable, not disabled: a disabled field cannot be
        // focused, so the one thing anybody wants from this row, the text,
        // was the one thing they could not take.
        hint="Fixed, because every invite link already sent points at it"
        trailing={<CopyButton value={address} what="the address" />}
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

      <ArchivedChannels workspaceId={workspace.id} slug={workspace.slug} canManage={canManage} />

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

/**
 * Where an archived channel goes.
 *
 * Archiving takes a channel out of every sidebar, and without a list like this
 * one there is no way back to what was said in it, which would make archiving
 * a quiet delete with reassuring words on the button. From here it can be
 * read, put back, or actually deleted.
 */
function ArchivedChannels({
  workspaceId,
  slug,
  canManage,
}: {
  workspaceId: string;
  slug: string;
  canManage: boolean;
}) {
  const { confirm, dialog } = useConfirm();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .archivedChannels(workspaceId)
      .then(setChannels)
      .catch(() => setChannels([]));
  }, [workspaceId]);

  useEffect(load, [load]);

  async function restore(channel: Channel) {
    setProblem(null);
    try {
      await api.updateChannel(channel.id, { archived: false });
      load();
    } catch {
      // The one way restoring fails: the name went to a channel made after it.
      setProblem(`Another channel is called ${channel.name ?? ''} now. Rename that one first.`);
    }
  }

  return (
    <section className="border-border flex flex-col gap-2 border-t pt-4">
      <h2 className="text-text-muted text-2xs font-semibold tracking-wide uppercase">Archived</h2>

      {channels === null ? (
        <Spinner label="Loading archived channels" />
      ) : channels.length === 0 ? (
        <p className="text-text-muted text-sm">Nothing is archived.</p>
      ) : (
        <>
          <p className="text-text-muted text-sm">
            Readable, closed to new messages, and no longer holding their names.
          </p>

          <ul className="flex flex-col gap-1">
            {channels.map((channel) => (
              <li
                key={channel.id}
                className="border-border bg-surface-raised flex min-h-11 items-center gap-2 rounded-lg border py-1 pr-1.5 pl-3"
              >
                <Link
                  to={`/w/${slug}/c/${channel.id}`}
                  className="text-text-primary min-w-0 flex-1 truncate text-sm no-underline"
                >
                  #{channel.name}
                </Link>

                {canManage ? (
                  /*
                   * Both bordered, so what lines up at the end of the row is a
                   * pair of boxes rather than two runs of floating text, and
                   * the one that cannot be undone is the red one. A ghost
                   * button with a red class on it was neither: the two colour
                   * utilities have the same weight and whichever the stylesheet
                   * happens to put last wins, which was the grey one.
                   */
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-3"
                      onClick={() => void restore(channel)}
                    >
                      Restore
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      className="px-3"
                      onClick={() =>
                        confirm({
                          title: `Delete #${channel.name ?? ''}`,
                          body: 'Every message, file and reply in it goes, for everybody, and none of it can be brought back.',
                          action: 'Delete',
                          run: async () => {
                            await api.deleteChannel(channel.id);
                            load();
                          },
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {problem ? <p className="text-critical text-sm">{problem}</p> : null}
      {dialog}
    </section>
  );
}
