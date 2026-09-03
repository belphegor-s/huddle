import type { WorkspaceMembership } from '@huddle/core';
import { Avatar, cx, Icon } from '@huddle/ui';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDismiss } from '../lib/use-dismiss';

interface WorkspaceSwitcherProps {
  current: { id: string; name: string; slug: string };
  workspaces: WorkspaceMembership[];
}

/**
 * Accepting an invite puts you in someone else's workspace, and without this
 * there is no way back to your own: the sidebar shows one workspace and the
 * URL is the only other handle. It is the header rather than a row further
 * down because the thing you press to change context should be the thing
 * naming the current one.
 */
export function WorkspaceSwitcher({ current, workspaces }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useDismiss(panel, () => setOpen(false));

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="hover:bg-surface-hover flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left"
      >
        <Avatar name={current.name} size="md" />
        <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
        <Icon
          name="chevronDown"
          className={cx(
            'text-text-muted size-4 transition-transform duration-(--duration-quick)',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="border-border bg-surface-raised shadow-popover absolute top-12 right-0 left-0 z-30 flex flex-col rounded-xl border p-1"
        >
          {workspaces.map(({ workspace, role }) => {
            const active = workspace.id === current.id;
            return (
              <button
                key={workspace.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (!active) void navigate(`/w/${workspace.slug}`);
                }}
                className={cx(
                  'flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm',
                  active ? 'bg-surface-active' : 'hover:bg-surface-hover',
                )}
              >
                <Avatar name={workspace.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{workspace.name}</span>
                  <span className="text-text-muted block truncate text-xs">{role}</span>
                </span>
                {active ? <Icon name="check" className="text-accent size-4" /> : null}
              </button>
            );
          })}

          <Link
            to="/new"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="border-border text-text-secondary hover:bg-surface-hover mt-1 flex min-h-11 items-center gap-2 rounded-lg border-t px-2 pt-1 text-sm no-underline"
          >
            <Icon name="plus" className="size-4" />
            Create a workspace
          </Link>
        </div>
      ) : null}
    </div>
  );
}
