import type { MemberProfile, Role } from '@huddle/core';
import { Avatar, Button, cx, Icon } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { outranksMember } from '../lib/roles';
import { useWorkspace } from '../lib/workspace';

/** Highest first, which is how the select reads. */
const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'guest', label: 'Guest' },
];

const PROBLEMS: Record<string, string> = {
  outranked: 'You cannot change someone at or above your own role.',
  last_owner: 'A workspace has to keep at least one owner.',
  cannot_change_own_role: 'You cannot change your own role.',
  forbidden: 'Only an admin can do that.',
};

export default function Members() {
  const { me, workspace, role, members, refresh } = useWorkspace();
  const navigate = useNavigate();

  const [rows, setRows] = useState<MemberProfile[]>(members);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setRows(members), [members]);

  const canManage = outranksMember(role, 'admin');

  async function act(userId: string, run: () => Promise<unknown>) {
    setBusy(userId);
    setProblem(null);

    try {
      await run();
      refresh();
      const fresh = await api.members(workspace.id);
      setRows(fresh);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'forbidden';
      setProblem(PROBLEMS[code] ?? 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    await api.removeMember(workspace.id, me.user.id);
    await navigate('/');
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto px-4 py-6">
      <header className="flex items-center gap-3">
        <Link
          to={`/w/${workspace.slug}`}
          aria-label="Back to channels"
          className="text-text-secondary hover:bg-surface-hover grid size-9 place-items-center rounded-lg no-underline md:hidden"
        >
          <Icon name="chevronLeft" className="size-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl">People</h1>
          <p className="text-text-muted text-xs">
            {rows.length} {rows.length === 1 ? 'person' : 'people'} in {workspace.name}
          </p>
        </div>
      </header>

      {problem ? (
        <p
          role="alert"
          className="border-critical text-critical rounded-lg border px-3 py-2 text-sm"
        >
          {problem}
        </p>
      ) : null}

      <ul className="flex flex-col gap-1">
        {rows.map((member) => {
          const isMe = member.id === me.user.id;
          // An admin can act on people below them, and never on themselves.
          const editable = canManage && !isMe && outranksMember(role, member.role);

          return (
            <li
              key={member.id}
              className="border-border bg-surface-raised flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <Avatar name={member.displayName} url={member.avatarUrl} size="md" />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {member.displayName}
                  {isMe ? <span className="text-text-muted font-normal"> (you)</span> : null}
                </span>
                <span className="text-text-muted text-xs capitalize">{member.role}</span>
              </span>

              {editable ? (
                <>
                  <label className="sr-only" htmlFor={`role-${member.id}`}>
                    Role for {member.displayName}
                  </label>
                  <select
                    id={`role-${member.id}`}
                    value={member.role}
                    disabled={busy === member.id}
                    onChange={(event) =>
                      void act(member.id, () =>
                        api.setMemberRole(workspace.id, member.id, event.target.value as Role),
                      )
                    }
                    className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
                  >
                    {ROLES.filter((option) => outranksMember(role, option.value)).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    aria-label={`Remove ${member.displayName}`}
                    title={`Remove ${member.displayName}`}
                    disabled={busy === member.id}
                    onClick={() =>
                      void act(member.id, () => api.removeMember(workspace.id, member.id))
                    }
                    className={cx(
                      'text-text-muted hover:text-critical hover:bg-surface-hover grid size-9 place-items-center rounded-lg',
                      busy === member.id && 'opacity-50',
                    )}
                  >
                    <Icon name="trash" className="size-4" />
                  </button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="border-border flex flex-col gap-2 border-t pt-4">
        <h2 className="text-text-muted text-2xs font-semibold tracking-wide uppercase">Leaving</h2>
        <p className="text-text-secondary text-sm">
          You keep everything you have written. A workspace has to keep one owner, so the last one
          cannot leave.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() =>
            void leave().catch((error: unknown) => {
              const code = error instanceof ApiError ? error.code : 'forbidden';
              setProblem(PROBLEMS[code] ?? 'That did not work.');
            })
          }
        >
          Leave {workspace.name}
        </Button>
      </div>
    </section>
  );
}
