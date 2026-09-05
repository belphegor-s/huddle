import { Avatar, Button, cx, Icon, Spinner, TextField } from '@huddle/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { AvatarEditor } from '../components/avatar-editor';
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
  const [picked, setPicked] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
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

  /**
   * Cropped before it is sent, then kept straight away.
   *
   * Choosing a picture is the decision. Showing the new one and quietly
   * waiting for somebody to also press Save left people believing they had
   * changed it when nothing had been stored.
   */
  async function uploadCropped(file: File) {
    setPicked(null);
    setProblem(null);
    setUploading(true);

    try {
      const attachment = await upload(workspace.id, file);
      await api.updateProfile({ avatarUrl: attachment.url });
      setAvatarUrl(attachment.url);
      refresh();
    } catch (error) {
      setProblem(UPLOAD_MESSAGES[error instanceof UploadError ? error.kind : 'refused']);
    } finally {
      setUploading(false);
    }
  }

  /** Removing one is a decision too, and is kept the same way. */
  async function removeAvatar() {
    setUploading(true);
    setProblem(null);

    try {
      await api.updateProfile({ avatarUrl: null });
      setAvatarUrl(null);
      refresh();
    } catch {
      setProblem('That did not save. Try again in a moment.');
    } finally {
      setUploading(false);
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

      {/*
        A card rather than a row of controls. Everything about how somebody
        appears sits in one panel, with the picture large enough to judge and
        the actions beside it rather than under it.
      */}
      <section className="border-border bg-surface-raised flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center">
        <span className="relative shrink-0 self-start sm:self-center">
          <Avatar name={clean || me.user.displayName} url={avatarUrl} size="xl" />
          {uploading ? (
            <span
              aria-label="Saving your picture"
              role="status"
              className="absolute inset-0 grid place-items-center rounded-2xl bg-black/45 text-white"
            >
              <Spinner />
            </span>
          ) : null}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            <p className="text-sm font-medium">Picture</p>
            <p className="text-text-muted text-xs">
              {features.files
                ? 'Cropped here and saved as a small square. The original never leaves this device.'
                : 'Pictures need object storage, which this instance has not configured.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              className={cx(
                'border-border bg-surface inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm',
                features.files
                  ? 'hover:bg-surface-hover cursor-pointer'
                  : 'cursor-not-allowed opacity-60',
              )}
            >
              <Icon name="image" className="size-4" />
              {avatarUrl ? 'Change' : 'Upload'}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={!features.files || uploading}
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  event.target.value = '';
                  if (chosen) setPicked(chosen);
                }}
              />
            </label>

            {avatarUrl ? (
              <button
                type="button"
                disabled={uploading}
                onClick={() => void removeAvatar()}
                className="text-text-muted hover:text-critical hover:bg-critical-soft min-h-10 rounded-lg px-3 text-sm disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </section>

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
          {saving ? <Spinner /> : null}
          {saving ? 'Saving' : 'Save'}
        </Button>
        {saved && !changed ? (
          <span className="text-text-muted flex items-center gap-1 text-sm">
            <Icon name="check" className="text-accent size-4" />
            Saved
          </span>
        ) : null}
      </div>

      {picked ? (
        <AvatarEditor
          file={picked}
          onCancel={() => setPicked(null)}
          onDone={(cropped) => void uploadCropped(cropped)}
        />
      ) : null}
    </form>
  );
}
