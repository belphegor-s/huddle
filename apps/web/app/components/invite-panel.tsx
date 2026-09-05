import type { InviteSummary } from '@huddle/core';
import { Button, CopyButton, cx, Icon } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useConfirm } from './confirm';
import { formatDay } from '../lib/format';

/**
 * Every live invitation, with its link, because a link that can only be copied
 * once is a link somebody has to regenerate every time it is lost.
 *
 * Readable by an admin and nobody else. Anyone holding one of these can join at
 * the role it names, which is why revoking is next to each one.
 */
export function InvitePanel({ workspaceId }: { workspaceId: string }) {
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

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
    try {
      await api.createInvite(workspaceId);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {dialog}

      <div className="flex items-center gap-3">
        <h2 className="text-text-muted text-2xs flex-1 font-semibold tracking-wide uppercase">
          Invitations
        </h2>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void create()}>
          {busy ? 'Creating' : 'New link'}
        </Button>
      </div>

      {invites.length === 0 ? (
        <p className="text-text-muted text-sm">
          No invitations are outstanding. A link lets anyone who has it join.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className={cx(
                'border-border bg-surface-raised flex flex-col gap-2 rounded-lg border p-3',
                invite.expired && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-3">
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
                  onClick={() =>
                    confirm({
                      title: 'Revoke this invitation',
                      body: 'Anybody holding the link stops being able to join. People who already used it stay.',
                      action: 'Revoke',
                      run: () => api.revokeInvite(workspaceId, invite.id).then(reload),
                    })
                  }
                  className="text-text-muted hover:text-critical hover:bg-surface-hover grid size-9 shrink-0 place-items-center rounded-lg"
                >
                  <Icon name="trash" className="size-4" />
                </button>
              </div>

              {invite.expired ? null : (
                /*
                 * The same shape as the workspace address: the value in a box
                 * with the control flush inside it, rather than a button
                 * sitting off to one side wearing the word Copy.
                 */
                <div className="border-border bg-surface flex items-center rounded-lg border py-1 pr-1 pl-2.5">
                  <output className="min-w-0 flex-1 truncate font-mono text-xs">
                    {`${window.location.origin}/join/${invite.token}`}
                  </output>
                  <CopyButton
                    value={`${window.location.origin}/join/${invite.token}`}
                    what="the invite link"
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
