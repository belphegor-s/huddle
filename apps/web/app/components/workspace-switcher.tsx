import type { WorkspaceMembership } from '@huddle/core';
import { Avatar, Icon, Menu, MenuButton, MenuItem, MenuLabel, MenuSeparator } from '@huddle/ui';
import { useNavigate } from 'react-router';
import { outranksMember } from '../lib/roles';

interface WorkspaceSwitcherProps {
  current: { id: string; name: string; slug: string };
  workspaces: WorkspaceMembership[];
  /** Settings only appear for somebody who can change them. */
  role: WorkspaceMembership['role'];
}

/**
 * Accepting an invite puts you in someone else's workspace, and without this
 * there is no way back to your own: the sidebar shows one workspace and the
 * URL is the only other handle. It is the header rather than a row further
 * down because the thing you press to change context should be the thing
 * naming the current one.
 */
export function WorkspaceSwitcher({ current, workspaces, role }: WorkspaceSwitcherProps) {
  const navigate = useNavigate();

  return (
    <Menu
      label="Workspaces"
      className="min-w-64"
      trigger={
        <MenuButton className="hover:bg-surface-hover flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left">
          <Avatar name={current.name} size="md" />
          <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
          <Icon name="chevronDown" className="text-text-muted size-4" />
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
