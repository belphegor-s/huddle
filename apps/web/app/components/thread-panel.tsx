import type { MemberProfile } from '@huddle/core';
import { useEffect } from 'react';
import { Avatar, Icon } from '@huddle/ui';
import type { ChannelStream } from '../lib/use-messages';
import { memberName } from '../lib/workspace';
import { Attachments } from './attachments';
import { MessageBody } from './message-body';
import { Composer } from './composer';

interface ThreadPanelProps {
  workspaceId: string;
  parentId: string;
  members: MemberProfile[];
  stream: ChannelStream;
  onClose(): void;
}

/**
 * The thread reads from the same stream as the channel rather than fetching
 * its own copy, so a reply arriving over the socket lands in both views at
 * once and neither can drift from the other.
 */
export function ThreadPanel({ workspaceId, parentId, members, stream, onClose }: ThreadPanelProps) {
  const { loadThread } = stream;

  // The channel page carries top level messages only, so the thread fetches
  // itself the first time it opens.
  useEffect(() => {
    void loadThread(parentId).catch(() => undefined);
  }, [parentId, loadThread]);

  const parent = stream.messages.find((message) => message.id === parentId);
  const replies = stream.messages.filter((message) => message.parentId === parentId);

  return (
    <aside className="border-border bg-surface absolute inset-0 z-10 flex flex-col border-l md:static md:z-auto md:w-96 md:shrink-0">
      <header className="border-border flex items-center gap-3 border-b px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <h2 className="flex-1 text-base font-semibold">Thread</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close thread"
          className="text-text-secondary hover:bg-surface-hover grid size-9 place-items-center rounded-lg"
        >
          <Icon name="close" className="size-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {parent ? (
          <article className="border-border flex gap-3 border-b pb-4">
            <Avatar name={memberName(members, parent.authorId)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{memberName(members, parent.authorId)}</p>
              <MessageBody body={parent.body} />
              <Attachments attachments={parent.attachments} />
            </div>
          </article>
        ) : null}

        <ol className="flex flex-col gap-3 pt-4">
          {replies.map((reply) => (
            <li key={reply.id} className="flex gap-3">
              <Avatar name={memberName(members, reply.authorId)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{memberName(members, reply.authorId)}</p>
                <MessageBody body={reply.body} />
                <Attachments attachments={reply.attachments} />
              </div>
            </li>
          ))}
          {replies.length === 0 ? (
            <li className="text-text-muted text-sm">No replies yet.</li>
          ) : null}
        </ol>
      </div>

      <Composer
        workspaceId={workspaceId}
        members={members}
        placeholder="Reply"
        onTyping={stream.notifyTyping}
        onSend={(input) => stream.send({ ...input, parentId })}
      />
    </aside>
  );
}
