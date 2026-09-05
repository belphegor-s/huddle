import type { ChannelSummary, MemberProfile, Me, Role, Workspace } from '@huddle/core';
import { Avatar, Button, Icon } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AssistantPanel } from '../components/assistant-panel';
import { CallStage } from '../components/call-stage';
import { ChannelMenu } from '../components/channel-menu';
import { Composer } from '../components/composer';
import { MessageList } from '../components/message-list';
import { ThreadPanel } from '../components/thread-panel';
import type { CallSession } from '../lib/call';
import type { Realtime } from '../lib/realtime';
import { useCall, useCallRoster } from '../lib/use-call';
import { useMessages } from '../lib/use-messages';
import { api } from '../lib/api';
import { outranksMember } from '../lib/roles';
import {
  channelLabel,
  channelTitle,
  dmAvatar,
  isDirect,
  memberName,
  startOfConversation,
  useWorkspace,
} from '../lib/workspace';

export default function ChannelRoute() {
  const { ref } = useParams();
  const { me, workspace, role, members, channels, realtime, call, features, refresh } =
    useWorkspace();
  const joined = channels.find(
    (candidate) => candidate.channel.name === ref || candidate.channel.id === ref,
  );

  const visiting = useVisitedChannel(workspace.id, ref, joined !== undefined);
  const summary = joined ?? visiting.summary;

  if (!summary) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl">{visiting.loading ? 'Opening' : 'Conversation not found'}</h1>
        {visiting.loading ? null : (
          <>
            <p className="text-text-secondary text-sm">
              It may have been archived, or you may not be in it.
            </p>
            <Link to={`/w/${workspace.slug}`} className="text-accent text-sm">
              Back to the workspace
            </Link>
          </>
        )}
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
      call={call}
      canUseAi={features.ai}
      canAttach={features.files}
      joined={joined !== undefined}
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
  call: CallSession;
  canUseAi: boolean;
  canAttach: boolean;
  joined: boolean;
  onChanged(): void;
}

function ChannelView({
  me,
  workspace,
  role,
  members,
  summary,
  realtime,
  call: session,
  canUseAi,
  canAttach,
  joined,
  onChanged,
}: ChannelViewProps) {
  const { call, join, leave, toggleMuted, toggleVideo, toggleSharing } = useCall(session);
  const inCall = useCallRoster(realtime, summary.channel.id, summary.callCount);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  const canModerate = outranksMember(role, 'admin');
  const stream = useMessages(realtime, summary.channel, me.user.id);
  const title = channelTitle(summary, members, me.user.id);
  const label = channelLabel(summary, members, me.user.id);
  const direct = isDirect(summary);

  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-surface flex items-center gap-3 border-b px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-5">
          <Link
            to={`/w/${workspace.slug}`}
            aria-label="Back to conversations"
            className="text-text-secondary hover:bg-surface-hover -ml-1 grid size-9 place-items-center rounded-lg no-underline md:hidden"
          >
            <Icon name="chevronLeft" className="size-5" />
          </Link>

          <div className="min-w-0 flex-1">
            {/*
              A channel is marked by a hash or a lock. A conversation is marked
              by whoever is in it, which is the only thing that identifies one.
            */}
            <h1 className="flex min-w-0 items-center gap-1.5 text-base font-semibold">
              {direct ? (
                <Avatar name={title} url={dmAvatar(summary, members, me.user.id)} size="sm" />
              ) : (
                <Icon
                  name={summary.channel.isPrivate ? 'lock' : 'hash'}
                  className="text-text-muted size-4"
                />
              )}
              <span className="truncate">{title}</span>
              {summary.channel.encrypted ? (
                <Icon
                  name="lock"
                  label="End to end encrypted"
                  className="text-positive size-3.5 shrink-0"
                />
              ) : null}
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

          <HuddleButton
            inCall={call.channelId === summary.channel.id}
            others={inCall}
            onJoin={() =>
              join(summary.channel.id, {
                video: false,
                ref: summary.channel.name ?? summary.channel.id,
                name: label,
              })
            }
          />

          <ChannelMenu
            summary={summary}
            workspaceSlug={workspace.slug}
            canManage={canModerate || summary.channel.createdBy === me.user.id}
            onChanged={onChanged}
          />
        </header>

        {joined ? null : <JoinBanner channelId={summary.channel.id} onJoined={onChanged} />}

        {/*
          Said plainly rather than left as an empty channel. A device with no
          key is the normal state for a new browser, and it clears as soon as
          somebody who has the key opens the channel.
        */}
        {stream.waitingForKey ? (
          <p className="border-border bg-surface-raised text-text-secondary flex items-center gap-2 border-b px-3 py-2 text-sm md:px-5">
            <Icon name="lock" className="text-text-muted size-4 shrink-0" />
            Waiting for a key. Nobody who has one is online right now, and the server cannot hand
            one over: that is what makes this conversation private.
          </p>
        ) : null}

        {call.channelId === summary.channel.id ? (
          <CallStage
            session={session}
            call={call}
            members={members}
            meId={me.user.id}
            onToggleMuted={toggleMuted}
            onToggleVideo={toggleVideo}
            onToggleSharing={toggleSharing}
            onLeave={leave}
          />
        ) : null}

        {call.error !== null && call.channelId === null ? (
          <p className="bg-critical-soft text-critical px-3 py-2 text-sm md:px-5">{call.error}</p>
        ) : null}

        {catchingUp ? (
          <AssistantPanel
            title={direct ? `What you missed from ${title}` : `What you missed in ${label}`}
            run={() => api.catchUp(summary.channel.id, summary.readSeq)}
            onClose={() => setCatchingUp(false)}
          />
        ) : null}

        <MessageList
          messages={stream.messages}
          locked={stream.locked}
          members={members}
          meId={me.user.id}
          canModerate={canModerate}
          readSeq={summary.readSeq}
          startLabel={startOfConversation(summary, members, me.user.id)}
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
          canAttach={canAttach}
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
          meId={me.user.id}
          stream={stream}
          canUseAi={canUseAi}
          canAttach={canAttach}
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

/**
 * A public channel someone has not joined is still readable, and a link to one
 * is the most common way anybody arrives. Resolving it here is what makes that
 * link work instead of answering "not found" to a channel the server is
 * perfectly willing to show.
 */
function useVisitedChannel(
  workspaceId: string,
  ref: string | undefined,
  alreadyJoined: boolean,
): { summary: ChannelSummary | null; loading: boolean } {
  const [summary, setSummary] = useState<ChannelSummary | null>(null);
  const [loading, setLoading] = useState(!alreadyJoined);

  useEffect(() => {
    if (alreadyJoined || ref === undefined) {
      setSummary(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void api
      .channelByRef(workspaceId, ref)
      .then((access) => {
        if (cancelled) return;
        setSummary({
          channel: access.channel,
          lastSeq: access.lastSeq,
          lastMessageAt: null,
          // Arriving fresh means caught up: a badge for everything said before
          // you got here is noise, not information.
          readSeq: access.lastSeq,
          unreadCount: 0,
          mentionCount: 0,
          notificationLevel: 'all',
          muted: false,
          callCount: 0,
          memberIds: [],
        });
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, ref, alreadyJoined]);

  return { summary, loading };
}

function JoinBanner({ channelId, onJoined }: { channelId: string; onJoined(): void }) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="border-border bg-surface-sunken flex items-center gap-3 border-b px-3 py-2 md:px-5">
      <p className="text-text-secondary flex-1 text-sm">
        You are browsing this channel. Sending a message joins it.
      </p>
      <Button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api
            .joinChannel(channelId)
            .then(onJoined)
            .finally(() => setBusy(false));
        }}
      >
        Join
      </Button>
    </div>
  );
}

/**
 * One control for two things, because to a person they are one thing: there is
 * a huddle here, and you are either in it or you are not.
 */
function HuddleButton({
  inCall,
  others,
  onJoin,
}: {
  inCall: boolean;
  others: number;
  onJoin(): void;
}) {
  if (inCall) return null;

  return (
    <button
      type="button"
      onClick={onJoin}
      className={
        others > 0
          ? 'bg-positive flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-white'
          : 'text-text-secondary hover:bg-surface-hover flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium'
      }
    >
      <Icon name="mic" className="size-4" />
      <span className="hidden sm:inline">{others > 0 ? `Join (${String(others)})` : 'Huddle'}</span>
    </button>
  );
}
