import type { MemberProfile, Message } from '@huddle/core';
import { Icon } from '@huddle/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDay, isSameDay } from '../lib/format';
import { MessageRow } from './message-row';

interface MessageListProps {
  messages: Message[];
  members: MemberProfile[];
  meId: string;
  canModerate: boolean;
  hasMore: boolean;
  /** Where the reader was when they arrived. Frozen, so the line stays put. */
  readSeq: number;
  onLoadOlder(): void;
  onReact(messageId: string, emoji: string, on: boolean): void;
  onOpenThread(messageId: string): void;
  onEdit(messageId: string, text: string): Promise<void>;
  onDelete(messageId: string): void;
}

/** Consecutive messages from one person within this window share a header. */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/** Past this far from the bottom, the reader is reading rather than following. */
const PINNED_SLACK_PX = 80;

export function MessageList({
  messages,
  members,
  meId,
  canModerate,
  hasMore,
  readSeq,
  onLoadOlder,
  onReact,
  onOpenThread,
  onEdit,
  onDelete,
}: MessageListProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Frozen on mount. If this tracked the live value the line would jump down
  // the moment the read receipt lands, which is exactly when you are reading it.
  const [markAfter] = useState(readSeq);

  const visible = messages.filter((message) => message.parentId === null);
  const lastId = visible.at(-1)?.id;

  // Scroll is decided before paint, so a new message never shows the list
  // jumping after the fact.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !pinned.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lastId]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    function onScroll() {
      if (!element) return;
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;

      pinned.current = distance < PINNED_SLACK_PX;
      setAtBottom(pinned.current);
      if (element.scrollTop < 200) onLoadOlder();
    }

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [onLoadOlder]);

  function jumpToLatest() {
    const element = viewport.current;
    if (!element) return;
    pinned.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }

  const firstUnread = visible.find(
    (message) => message.seq > markAfter && message.authorId !== meId,
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={viewport} className="h-full overflow-y-auto overscroll-contain px-3 py-4 md:px-5">
        <p className="text-text-muted py-2 text-center text-xs">
          {hasMore ? 'Loading earlier messages' : 'This is the start of the channel'}
        </p>

        <ol aria-label="Messages" className="flex flex-col gap-0.5">
          {visible.map((message, index) => {
            const previous = visible[index - 1];
            const newDay =
              previous === undefined ||
              !isSameDay(new Date(previous.createdAt), new Date(message.createdAt));

            const grouped =
              !newDay &&
              previous !== undefined &&
              previous.authorId === message.authorId &&
              message.createdAt - previous.createdAt < GROUPING_WINDOW_MS &&
              previous.deletedAt === null &&
              message.id !== firstUnread?.id;

            return (
              <li key={message.id} className="contents">
                {newDay ? <DayDivider at={message.createdAt} /> : null}
                {message.id === firstUnread?.id ? <UnreadDivider /> : null}

                <MessageRow
                  message={message}
                  members={members}
                  meId={meId}
                  canModerate={canModerate}
                  grouped={grouped}
                  onReact={onReact}
                  onOpenThread={onOpenThread}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </li>
            );
          })}
        </ol>
      </div>

      {atBottom ? null : (
        <button
          type="button"
          onClick={jumpToLatest}
          className="border-border bg-surface-raised shadow-popover text-text-secondary hover:text-text-primary absolute right-4 bottom-4 flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs"
        >
          <Icon name="chevronDown" className="size-4" />
          Jump to latest
        </button>
      )}
    </div>
  );
}

function DayDivider({ at }: { at: number }) {
  return (
    <div className="flex items-center gap-3 py-3" role="separator">
      <span className="bg-border h-px flex-1" />
      <time
        dateTime={new Date(at).toISOString()}
        className="border-border bg-surface text-text-muted text-2xs rounded-full border px-2.5 py-0.5 font-medium"
      >
        {formatDay(at)}
      </time>
      <span className="bg-border h-px flex-1" />
    </div>
  );
}

function UnreadDivider() {
  return (
    <div className="flex items-center gap-3 py-2" role="separator" aria-label="New messages">
      <span className="bg-accent h-px flex-1" />
      <span className="text-accent text-2xs font-semibold tracking-wide uppercase">New</span>
    </div>
  );
}
