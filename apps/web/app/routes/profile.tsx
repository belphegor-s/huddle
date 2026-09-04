import { Avatar, Button, Icon, TextField } from '@huddle/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { upload, UploadError, UPLOAD_MESSAGES } from '../lib/uploads';
import { handleOf } from '../lib/rich-text';
import { useWorkspace } from '../lib/workspace';

/**
 * Everyone arrives with a display name guessed from their email address, and
 * until this existed there was no way to correct it. The handle other people
 * type to mention you is derived from that name, so it is shown here rather
 * than left to be discovered.
 */
export default function Profile() {
  const { me, workspace, features, refresh } = useWorkspace();

  const [displayName, setDisplayName] = useState(me.user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(me.user.avatarUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const clean = displayName.trim();
  const changed = clean !== me.user.displayName || avatarUrl !== me.user.avatarUrl;

  async function save() {
    if (clean === '') return;

    setSaving(true);
    setProblem(null);

    try {
      await api.updateProfile({ displayName: clean, avatarUrl });
      setSaved(true);
      refresh();
    } catch {
      setProblem('That did not save. Try again in a moment.');
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;

    setProblem(null);
    try {
      const attachment = await upload(workspace.id, file);
      setAvatarUrl(attachment.url);
      setSaved(false);
    } catch (error) {
      setProblem(UPLOAD_MESSAGES[error instanceof UploadError ? error.kind : 'refused']);
    }
  }

  return (
    // A real form, so Enter saves. It was a section with loose fields and a
    // button that did not submit anything, which left the keyboard with no way
    // to finish the job.
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
          className="text-text-secondary hover:bg-surface-hover grid size-9 place-items-center rounded-lg no-underline md:hidden"
        >
          <Icon name="chevronLeft" className="size-5" />
        </Link>
        <h1 className="flex-1 text-xl">Your profile</h1>
      </header>

      <div className="flex items-center gap-4">
        <Avatar name={clean || me.user.displayName} url={avatarUrl} size="lg" />
        <div className="flex flex-col gap-1">
          <label className="border-border hover:bg-surface-hover inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
            <Icon name="image" className="size-4" />
            {avatarUrl ? 'Change picture' : 'Add a picture'}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={!features.files}
              onChange={(event) => {
                void pickAvatar(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          {features.files ? null : (
            <p className="text-text-muted text-xs">
              Pictures need object storage, which this instance has not configured.
            </p>
          )}
          {avatarUrl ? (
            <button
              type="button"
              onClick={() => {
                setAvatarUrl(null);
                setSaved(false);
              }}
              className="text-text-muted hover:text-text-primary self-start text-xs"
            >
              Remove it
            </button>
          ) : null}
        </div>
      </div>

      <TextField
        label="Display name"
        value={displayName}
        maxLength={80}
        onChange={(event) => {
          setDisplayName(event.target.value);
          setSaved(false);
        }}
        hint={`People mention you by typing @${handleOf(clean || me.user.displayName)}`}
        error={problem}
      />

      <TextField label="Email" value={me.user.email} readOnly disabled hint="Sign in address" />

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
    </form>
  );
}
