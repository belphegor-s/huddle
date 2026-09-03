import type { InviteSummary } from '@huddle/core';
import { Button, cx, Icon } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDay } from '../lib/format';

/**
 * The link is shown once, when it is made, and never again. Only a hash of the
 * token is stored, so there is nothing to show later: a database leak cannot
 * hand out working invitations, and that is worth more than the convenience of
 * copying an old one.
 */
export function InvitePanel({ workspaceId }: { workspaceId: string }) {
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setInvites(await api.invites(workspaceId).catch(() => []));
  }

  useEffect(() => {
    void reload();
    // Reloads when the workspace changes, which is the only time it can differ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function create() {
    setBusy(true);
    setCopied(false);

    try {
      const invite = await api.createInvite(workspaceId);
      setFresh(`${window.location.origin}/join/${invite.token}`);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-text-muted text-2xs font-semibold tracking-wide uppercase">
        Invitations
      </h2>

      {fresh ? (
        <div className="border-accent/40 bg-accent-soft/40 flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-text-secondary text-xs">
            Copy this now. It is not stored, so it cannot be shown again.
          </p>
          <div className="flex items-center gap-2">
            <output className="border-border bg-surface flex-1 rounded-lg border px-2 py-1.5 font-mono text-xs break-all">
              {fresh}
            </output>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(fresh).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={busy}
        onClick={() => void create()}
      >
        {busy ? 'Creating' : 'Create an invite link'}
      </Button>

      {invites.length === 0 ? (
        <p className="text-text-muted text-sm">No invitations are outstanding.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="border-border bg-surface-raised flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm capitalize">{invite.role}</span>
                <span
                  className={cx(
                    'block text-xs',
                    invite.expired ? 'text-critical' : 'text-text-muted',
                  )}
                >
                  {invite.expired ? 'Expired' : `Expires ${formatDay(invite.expiresAt)}`}
                  {invite.maxUses === null
                    ? `, used ${invite.useCount} times`
                    : `, ${invite.useCount} of ${invite.maxUses} used`}
                </span>
              </span>

              <button
                type="button"
                aria-label="Revoke this invitation"
                title="Revoke this invitation"
                onClick={() => {
                  void api.revokeInvite(workspaceId, invite.id).then(reload);
                }}
                className="text-text-muted hover:text-critical hover:bg-surface-hover grid size-9 place-items-center rounded-lg"
              >
                <Icon name="trash" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
