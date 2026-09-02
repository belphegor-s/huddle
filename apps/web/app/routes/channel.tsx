import type { ChannelSummary, MemberProfile, Me, Workspace } from '@huddle/core';
import { Avatar } from '@huddle/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Composer } from '../components/composer';
import { MessageList } from '../components/message-list';
import { ThreadPanel } from '../components/thread-panel';
import type { Realtime } from '../lib/realtime';
import { useMessages } from '../lib/use-messages';
import { channelTitle, memberName, useWorkspace } from '../lib/workspace';

export default function ChannelRoute() {
  const { ref } = useParams();
  const { me, workspace, members, channels, realtime, refresh } = useWorkspace();

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
      members={members}
      summary={summary}
      realtime={realtime}
      onSent={refresh}
    />
  );
}

interface ChannelViewProps {
  me: Me;
  workspace: Workspace;
  members: MemberProfile[];
  summary: ChannelSummary;
  realtime: Realtime;
  onSent(): void;
}

function ChannelView({ me, workspace, members, summary, realtime, onSent }: ChannelViewProps) {
  const [threadId, setThreadId] = useState<string | null>(null);
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
            className="text-text-secondary -ml-1 grid size-9 place-items-center rounded-lg text-lg no-underline md:hidden"
          >
            {'‹'}
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{label}</h1>
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
        </header>

        <MessageList
          messages={stream.messages}
          members={members}
          meId={me.user.id}
          hasMore={stream.hasMore}
          onLoadOlder={() => void stream.loadOlder()}
          onReact={(messageId, emoji, on) => void stream.react(messageId, emoji, on)}
          onOpenThread={setThreadId}
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
            onSent();
          }}
        />
      </div>

      {threadId ? (
        <ThreadPanel
          workspaceId={workspace.id}
          parentId={threadId}
          members={members}
          stream={stream}
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
