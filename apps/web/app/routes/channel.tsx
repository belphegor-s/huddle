import type { ChannelSummary, MemberProfile, Me, Role, Workspace } from '@huddle/core';
import { Avatar, Icon } from '@huddle/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AssistantPanel } from '../components/assistant-panel';
import { ChannelMenu } from '../components/channel-menu';
import { Composer } from '../components/composer';
import { MessageList } from '../components/message-list';
import { ThreadPanel } from '../components/thread-panel';
import type { Realtime } from '../lib/realtime';
import { useMessages } from '../lib/use-messages';
import { api } from '../lib/api';
import { outranksMember } from '../lib/roles';
import { channelTitle, memberName, useWorkspace } from '../lib/workspace';

export default function ChannelRoute() {
  const { ref } = useParams();
  const { me, workspace, role, members, channels, realtime, features, refresh } = useWorkspace();

  const summary = channels.find(
    (candidate) => candidate.channel.name === ref || candidate.channel.id === ref,
  );

  if (!summary) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl">Channel not found</h1>
        <p className="text-text-secondary text-sm">
          It may have been archived, or you may not be a member of it.
        </p>
        <Link to={`/w/${workspace.slug}`} className="text-accent text-sm">
          Back to the workspace
        </Link>
      </section>
    );
  }

  // Keyed on the channel, so switching rooms resets the stream rather than
  // letting one channel's messages flash inside another.
  return (
    <ChannelView
      key={summary.channel.id}
      me={me}
      workspace={workspace}
      role={role}
      members={members}
      summary={summary}
      realtime={realtime}
      canUseAi={features.ai}
      onChanged={refresh}
    />
  );
}

interface ChannelViewProps {
  me: Me;
  workspace: Workspace;
  role: Role;
  members: MemberProfile[];
  summary: ChannelSummary;
  realtime: Realtime;
  canUseAi: boolean;
  onChanged(): void;
}

function ChannelView({
  me,
  workspace,
  role,
  members,
  summary,
  realtime,
  canUseAi,
  onChanged,
}: ChannelViewProps) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  const canModerate = outranksMember(role, 'admin');
  const stream = useMessages(realtime, summary.channel.id, me.user.id);
  const title = channelTitle(summary, members, me.user.id);
  const label = summary.channel.kind === 'channel' ? `#${title}` : title;

  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-surface flex items-center gap-3 border-b px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-5">
          <Link
            to={`/w/${workspace.slug}`}
            aria-label="Back to channels"
            className="text-text-secondary hover:bg-surface-hover -ml-1 grid size-9 place-items-center rounded-lg no-underline md:hidden"
          >
            <Icon name="chevronLeft" className="size-5" />
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="flex min-w-0 items-center gap-1 text-base font-semibold">
              {summary.channel.kind === 'channel' ? (
                <Icon
                  name={summary.channel.isPrivate ? 'lock' : 'hash'}
                  className="text-text-muted size-4"
                />
              ) : null}
              <span className="truncate">{title}</span>
            </h1>
            {summary.channel.topic ? (
              <p className="text-text-muted truncate text-xs">{summary.channel.topic}</p>
            ) : null}
          </div>

          <ul className="hidden items-center -space-x-1.5 md:flex">
            {stream.present.slice(0, 5).map((userId) => (
              <li key={userId} title={memberName(members, userId)}>
                <Avatar name={memberName(members, userId)} size="sm" />
              </li>
            ))}
          </ul>

          {canUseAi && summary.unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => setCatchingUp(true)}
              className="text-accent hover:bg-accent-soft flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium"
            >
              <Icon name="sparkle" className="size-4" />
              <span className="hidden sm:inline">Catch up</span>
            </button>
          ) : null}

          <ChannelMenu summary={summary} workspaceSlug={workspace.slug} onChanged={onChanged} />
        </header>

        {catchingUp ? (
          <AssistantPanel
            title={`What you missed in ${label}`}
            run={() => api.catchUp(summary.channel.id, summary.readSeq)}
            onClose={() => setCatchingUp(false)}
          />
        ) : null}

        <MessageList
          messages={stream.messages}
          members={members}
          meId={me.user.id}
          canModerate={canModerate}
          readSeq={summary.readSeq}
          hasMore={stream.hasMore}
          onLoadOlder={() => void stream.loadOlder()}
          onReact={(messageId, emoji, on) => void stream.react(messageId, emoji, on)}
          onOpenThread={setThreadId}
          onEdit={stream.edit}
          onDelete={(messageId) => void stream.remove(messageId)}
        />

        <TypingLine names={stream.typing.map((id) => memberName(members, id))} />

        <Composer
          workspaceId={workspace.id}
          members={members}
          placeholder={`Message ${label}`}
          onTyping={stream.notifyTyping}
          onSend={async (input) => {
            await stream.send({ ...input, parentId: null });
            onChanged();
          }}
        />
      </div>

      {threadId ? (
        <ThreadPanel
          workspaceId={workspace.id}
          channelId={summary.channel.id}
          parentId={threadId}
          members={members}
          stream={stream}
          canUseAi={canUseAi}
          onClose={() => setThreadId(null)}
        />
      ) : null}
    </section>
  );
}

function TypingLine({ names }: { names: string[] }) {
  return (
    <p aria-live="polite" className="text-text-muted h-5 px-3 text-xs md:px-5">
      {names.length === 0
        ? ''
        : names.length === 1
          ? `${names[0]} is typing`
          : `${names.length} people are typing`}
    </p>
  );
}
