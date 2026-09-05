import type { Channel, ChannelSummary, MemberProfile, Me, Role, Workspace } from '@huddle/core';
import type { IconName } from '@huddle/ui';
import { Avatar, cx, Icon } from '@huddle/ui';
import { Link, NavLink } from 'react-router';
import { presenceOf } from '../lib/presence';
import { useCollapsed } from '../lib/use-collapsed';
import { channelTitle, dmAvatar } from '../lib/workspace';
import { PushToggle } from './push-toggle';
import { StatusMenu } from './status-menu';
import { WorkspaceSwitcher } from './workspace-switcher';

interface SidebarProps {
  me: Me;
  workspace: Workspace;
  role: Role;
  channels: ChannelSummary[];
  members: MemberProfile[];
  /** Public channels in the workspace this person has not joined. */
  discoverable: Channel[];
  className?: string;
  onCreateChannel(): void;
  onStartDm(): void;
  onChanged(): void;
}

export function Sidebar({
  me,
  workspace,
  role,
  channels,
  members,
  discoverable,
  className,
  onCreateChannel,
  onStartDm,
  onChanged,
}: SidebarProps) {
  const rooms = channels.filter((summary) => summary.channel.kind === 'channel');
  const direct = channels.filter((summary) => summary.channel.kind !== 'channel');
  const [collapsed, setCollapsed] = useCollapsed();

  /*
   * Collapsing is a desktop idea. On a phone the sidebar and the conversation
   * are already two screens, so a rail there would be a screen of icons with
   * nothing beside it, which is why every rule below is behind md.
   */
  /*
   * Hidden from the eye, not from the page. Removing a label outright leaves
   * a screen reader announcing a link as "G", which is worse than a wide
   * sidebar could ever be.
   */
  const rail = collapsed ? 'md:sr-only' : '';

  return (
    <nav
      className={cx(
        'border-border bg-surface-sunken flex w-full flex-col gap-1 overflow-x-hidden overflow-y-auto border-r px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        'motion-safe:transition-[width] motion-safe:duration-200',
        collapsed ? 'md:w-16' : 'md:w-64',
        className,
      )}
    >
      {/*
        The toggle sits over the end of the switcher rather than beside it.
        Beside it, the row was narrower than the sidebar by the width of a
        button, and the menu hanging off that row inherited the gap.
      */}
      <header className="relative py-2">
        <WorkspaceSwitcher
          current={workspace}
          workspaces={me.workspaces}
          role={role}
          compact={collapsed}
        />

        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Widen the sidebar' : 'Narrow the sidebar'}
          title={collapsed ? 'Widen the sidebar' : 'Narrow the sidebar'}
          aria-expanded={!collapsed}
          className={cx(
            'text-text-muted hover:text-text-primary hover:bg-surface-active absolute top-1/2 right-1 hidden size-8 -translate-y-1/2 place-items-center rounded-lg md:grid',
            collapsed && 'md:hidden',
          )}
        >
          <Icon name="chevronLeft" className="size-4" />
        </button>
      </header>

      {/* In the rail the toggle needs a line of its own, or it has nowhere to sit. */}
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Widen the sidebar"
          title="Widen the sidebar"
          className="text-text-muted hover:text-text-primary hover:bg-surface-hover mx-auto hidden size-9 place-items-center rounded-lg md:grid"
        >
          <Icon name="chevronLeft" className="size-4 rotate-180" />
        </button>
      ) : null}

      <Link
        to={`/w/${workspace.slug}/search`}
        title="Search messages"
        className={cx(
          'text-text-secondary hover:bg-surface-hover mb-2 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline',
          collapsed && 'md:justify-center md:px-0',
        )}
      >
        <Icon name="search" className="size-4 shrink-0" />
        <span className={rail}>Search messages</span>
      </Link>

      <Link
        to={`/w/${workspace.slug}/people`}
        title="People"
        className={cx(
          'text-text-secondary hover:bg-surface-hover mb-2 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline',
          collapsed && 'md:justify-center md:px-0',
        )}
      >
        <Icon name="people" className="size-4 shrink-0" />
        <span className={rail}>People</span>
      </Link>

      <Section
        title="Channels"
        actionLabel="New channel"
        collapsed={collapsed}
        onAction={onCreateChannel}
      />
      <ul className="flex flex-col">
        {rooms.map((summary) => (
          <ChannelRow
            key={summary.channel.id}
            workspaceSlug={workspace.slug}
            summary={summary}
            label={summary.channel.name ?? ''}
            icon={summary.channel.isPrivate ? 'lock' : 'hash'}
            collapsed={collapsed}
          />
        ))}
        {rooms.length === 0 && discoverable.length === 0 ? (
          <Empty collapsed={collapsed}>No channels yet</Empty>
        ) : null}

        {/*
          Public channels you have not joined. They were invisible before, so a
          workspace looked empty to everybody who had not been added to things
          one at a time.
        */}
        {discoverable.map((channel) => (
          <li key={channel.id}>
            <NavLink
              to={`/w/${workspace.slug}/c/${channel.name ?? channel.id}`}
              className={({ isActive }) =>
                cx(
                  'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline',
                  isActive
                    ? 'bg-surface-active text-text-primary'
                    : 'text-text-muted hover:bg-surface-hover',
                )
              }
            >
              <Icon name="hash" className="size-4 opacity-60" />
              <span className="min-w-0 flex-1 truncate">{channel.name}</span>
              <span className="text-2xs text-text-muted shrink-0">Join</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <Section
        title="Direct messages"
        actionLabel="New message"
        collapsed={collapsed}
        onAction={onStartDm}
      />
      <ul className="flex flex-col">
        {direct.map((summary) => (
          <ChannelRow
            key={summary.channel.id}
            workspaceSlug={workspace.slug}
            summary={summary}
            label={channelTitle(summary, members, me.user.id)}
            icon="people"
            member={otherMember(summary, members, me.user.id)}
            avatarUrl={dmAvatar(summary, members, me.user.id)}
            collapsed={collapsed}
          />
        ))}
        {direct.length === 0 ? <Empty collapsed={collapsed}>No conversations yet</Empty> : null}
      </ul>

      <div className={cx('mt-auto', collapsed && 'md:hidden')}>
        <PushToggle />
      </div>

      {/* No padding of its own: the row inside it is a sidebar row, the same
          width as the one in the header, so the menus hanging off both line up. */}
      <footer className="border-border flex items-center border-t pt-3">
        <StatusMenu
          me={me}
          workspaceSlug={workspace.slug}
          compact={collapsed}
          onChanged={onChanged}
        />
      </footer>
    </nav>
  );
}

function Section({
  title,
  actionLabel,
  collapsed,
  onAction,
}: {
  title: string;
  actionLabel: string;
  collapsed: boolean;
  onAction(): void;
}) {
  return (
    <div
      className={cx(
        'mt-3 flex items-center justify-between px-3',
        collapsed && 'md:justify-center md:px-0',
      )}
    >
      <h2
        className={cx(
          'text-text-muted text-2xs font-semibold tracking-wide uppercase',
          collapsed && 'md:hidden',
        )}
      >
        {title}
      </h2>
      <button
        type="button"
        onClick={onAction}
        aria-label={actionLabel}
        title={actionLabel}
        className="text-text-muted hover:text-text-primary hover:bg-surface-hover grid size-6 place-items-center rounded-md"
      >
        <Icon name="plus" className="size-4" />
      </button>
    </div>
  );
}

/** The other person in a one to one conversation, whose presence is worth showing. */
function otherMember(
  summary: ChannelSummary,
  members: MemberProfile[],
  meId: string,
): MemberProfile | null {
  if (summary.channel.kind !== 'dm') return null;

  const otherId = summary.memberIds.find((id) => id !== meId);
  return members.find((one) => one.id === otherId) ?? null;
}

function ChannelRow({
  workspaceSlug,
  summary,
  label,
  icon,
  member,
  avatarUrl,
  collapsed,
}: {
  workspaceSlug: string;
  summary: ChannelSummary;
  label: string;
  icon: IconName;
  member?: MemberProfile | null;
  avatarUrl?: string | null;
  collapsed: boolean;
}) {
  const unread = summary.unreadCount > 0;

  return (
    <li>
      <NavLink
        to={`/w/${workspaceSlug}/c/${summary.channel.name ?? summary.channel.id}`}
        title={label}
        className={({ isActive }) =>
          cx(
            'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline',
            collapsed && 'md:justify-center md:px-0',
            isActive
              ? 'bg-surface-active text-text-primary'
              : 'text-text-secondary hover:bg-surface-hover',
            // Unread is weight and colour, never a dot on its own: a dot alone
            // is invisible to anyone scanning a long list quickly.
            unread && 'text-text-primary font-semibold',
          )
        }
      >
        {member ? (
          <Avatar
            name={label}
            url={avatarUrl}
            size="sm"
            presence={presenceOf(member, summary.callCount > 0)}
          />
        ) : (
          <>
            <Icon name={icon} className={cx('text-text-muted size-4', collapsed && 'md:hidden')} />
            {/*
              A rail of identical hashes tells nobody which channel is which.
              The first letter does, and keeps the row the size of every other.
            */}
            {collapsed ? (
              <span
                aria-hidden
                className="bg-surface-active text-text-secondary text-2xs hidden size-7 place-items-center rounded-md font-semibold uppercase md:grid"
              >
                {label.slice(0, 1)}
              </span>
            ) : null}
          </>
        )}
        <span className={cx('min-w-0 flex-1 truncate', collapsed && 'md:sr-only')}>{label}</span>
        {/*
          A call is happening whether or not you have read the channel, so it
          reads before the unread badge rather than replacing it.
        */}
        {summary.callCount > 0 ? (
          <span
            className="bg-positive size-2 rounded-full motion-safe:animate-pulse"
            aria-label={`${String(summary.callCount)} in a huddle`}
          />
        ) : null}

        {summary.mentionCount > 0 ? (
          <span className="bg-accent text-on-accent text-2xs rounded-full px-1.5 py-0.5 font-semibold">
            {summary.mentionCount}
          </span>
        ) : unread ? (
          <span className="bg-text-muted size-1.5 rounded-full" aria-label="Unread" />
        ) : null}
      </NavLink>
    </li>
  );
}

function Empty({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  return (
    <li className={cx('text-text-muted px-3 py-2 text-xs', collapsed && 'md:hidden')}>
      {children}
    </li>
  );
}
