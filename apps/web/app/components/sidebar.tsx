import type { ChannelSummary, MemberProfile, Me, Workspace } from '@huddle/core';
import { Avatar, Button, cx } from '@huddle/ui';
import { Form, Link, NavLink } from 'react-router';
import { channelTitle } from '../lib/workspace';

interface SidebarProps {
  me: Me;
  workspace: Workspace;
  channels: ChannelSummary[];
  members: MemberProfile[];
  className?: string;
  onCreateChannel(): void;
  onStartDm(): void;
}

export function Sidebar({
  me,
  workspace,
  channels,
  members,
  className,
  onCreateChannel,
  onStartDm,
}: SidebarProps) {
  const rooms = channels.filter((summary) => summary.channel.kind === 'channel');
  const direct = channels.filter((summary) => summary.channel.kind !== 'channel');

  return (
    <nav
      className={cx(
        'border-border bg-surface-sunken flex w-full flex-col gap-1 overflow-y-auto border-r px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] md:w-64',
        className,
      )}
    >
      <header className="flex items-center gap-2 px-2 py-3">
        <Avatar name={workspace.name} size="md" />
        <p className="min-w-0 flex-1 truncate font-medium">{workspace.name}</p>
      </header>

      <Link
        to={`/w/${workspace.slug}/search`}
        className="text-text-secondary hover:bg-surface-hover mb-2 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline"
      >
        Search messages
      </Link>

      <Section title="Channels" actionLabel="New channel" onAction={onCreateChannel} />
      <ul className="flex flex-col">
        {rooms.map((summary) => (
          <ChannelRow
            key={summary.channel.id}
            workspaceSlug={workspace.slug}
            summary={summary}
            label={`# ${summary.channel.name ?? ''}`}
          />
        ))}
        {rooms.length === 0 ? <Empty>No channels yet</Empty> : null}
      </ul>

      <Section title="Direct messages" actionLabel="New message" onAction={onStartDm} />
      <ul className="flex flex-col">
        {direct.map((summary) => (
          <ChannelRow
            key={summary.channel.id}
            workspaceSlug={workspace.slug}
            summary={summary}
            label={channelTitle(summary, members, me.user.id)}
          />
        ))}
        {direct.length === 0 ? <Empty>No conversations yet</Empty> : null}
      </ul>

      <footer className="border-border mt-auto flex items-center gap-2 border-t px-2 pt-3">
        <Avatar name={me.user.displayName} url={me.user.avatarUrl} size="md" />
        <span className="min-w-0 flex-1 truncate text-sm">{me.user.displayName}</span>
        <Form method="post" action="/signout">
          <Button type="submit" variant="ghost">
            Sign out
          </Button>
        </Form>
      </footer>
    </nav>
  );
}

function Section({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction(): void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between px-3">
      <h2 className="text-text-muted text-2xs font-semibold tracking-wide uppercase">{title}</h2>
      <button
        type="button"
        onClick={onAction}
        aria-label={actionLabel}
        title={actionLabel}
        className="text-text-muted hover:text-text-primary grid size-6 place-items-center rounded-md text-base leading-none"
      >
        +
      </button>
    </div>
  );
}

function ChannelRow({
  workspaceSlug,
  summary,
  label,
}: {
  workspaceSlug: string;
  summary: ChannelSummary;
  label: string;
}) {
  const unread = summary.unreadCount > 0;

  return (
    <li>
      <NavLink
        to={`/w/${workspaceSlug}/c/${summary.channel.name ?? summary.channel.id}`}
        className={({ isActive }) =>
          cx(
            'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm no-underline',
            isActive
              ? 'bg-surface-active text-text-primary'
              : 'text-text-secondary hover:bg-surface-hover',
            // Unread is weight and colour, never a dot on its own: a dot alone
            // is invisible to anyone scanning a long list quickly.
            unread && 'text-text-primary font-semibold',
          )
        }
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
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

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="text-text-muted px-3 py-2 text-xs">{children}</li>;
}
