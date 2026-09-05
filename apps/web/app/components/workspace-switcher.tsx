import type { WorkspaceMembership } from '@huddle/core';
import { Avatar, cx, Icon, Menu, MenuButton, MenuItem, MenuLabel, MenuSeparator } from '@huddle/ui';
import { useNavigate } from 'react-router';
import { outranksMember } from '../lib/roles';

interface WorkspaceSwitcherProps {
  current: { id: string; name: string; slug: string };
  workspaces: WorkspaceMembership[];
  /** Settings only appear for somebody who can change them. */
  role: WorkspaceMembership['role'];
  /** In the rail, the name has nowhere to go and only the mark is shown. */
  compact?: boolean;
}

/**
 * Accepting an invite puts you in someone else's workspace, and without this
 * there is no way back to your own: the sidebar shows one workspace and the
 * URL is the only other handle. It is the header rather than a row further
 * down because the thing you press to change context should be the thing
 * naming the current one.
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
  role,
  compact = false,
}: WorkspaceSwitcherProps) {
  const navigate = useNavigate();

  return (
    <Menu
      label="Workspaces"
      // The panel takes the width of the row it hangs from, so it lines up
      // with the sidebar's own padding rather than sitting near it.
      matchTrigger={!compact}
      className={compact ? 'min-w-56' : ''}
      trigger={
        <MenuButton
          title={current.name}
          className={cx(
            'hover:bg-surface-hover flex min-h-11 w-full items-center gap-2 rounded-lg text-left',
            // Room at the end for the collapse control that sits over it.
            compact ? 'md:justify-center md:px-0' : 'pr-11 pl-2',
          )}
        >
          <Avatar name={current.name} size="md" />
          <span className={cx('min-w-0 flex-1 truncate font-medium', compact && 'md:sr-only')}>
            {current.name}
          </span>
          <Icon
            name="chevronDown"
            // Hidden wherever the collapse control sits over this row, which
            // is every width that has one.
            className={cx('text-text-muted size-4 shrink-0', 'md:hidden')}
          />
        </MenuButton>
      }
    >
      <>
        <MenuLabel>Workspaces</MenuLabel>
        {workspaces.map(({ workspace, role: theirs }) => (
          <MenuItem
            key={workspace.id}
            selected={workspace.id === current.id}
            // A role reads as a proper noun beside a name. The hint itself is
            // not capitalised for everybody, because most are sentences.
            hint={`${theirs.charAt(0).toUpperCase()}${theirs.slice(1)}`}
            onSelect={() => {
              if (workspace.id !== current.id) void navigate(`/w/${workspace.slug}`);
            }}
          >
            {workspace.name}
          </MenuItem>
        ))}

        <MenuSeparator />

        {outranksMember(role, 'admin') ? (
          <MenuItem icon="edit" onSelect={() => void navigate(`/w/${current.slug}/settings`)}>
            Workspace settings
          </MenuItem>
        ) : null}

        <MenuItem icon="people" onSelect={() => void navigate(`/w/${current.slug}/people`)}>
          People and invitations
        </MenuItem>

        <MenuItem icon="plus" onSelect={() => void navigate('/new')}>
          Create a workspace
        </MenuItem>
      </>
    </Menu>
  );
}
