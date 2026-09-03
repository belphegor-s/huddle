import type { MemberProfile, Message } from '@huddle/core';
import { Avatar, cx, Icon } from '@huddle/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { memberAvatar, memberName } from '../lib/workspace';
import { Attachments } from './attachments';
import { EmojiPicker } from './emoji-picker';
import { MessageBody } from './message-body';
import { Reactions } from './reactions';

interface MessageListProps {
  messages: Message[];
  members: MemberProfile[];
  meId: string;
  hasMore: boolean;
  onLoadOlder(): void;
  onReact(messageId: string, emoji: string, on: boolean): void;
  onOpenThread(messageId: string): void;
  onDelete(messageId: string): void;
}

/** Consecutive messages from one person within this window share a header. */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

export function MessageList({
  messages,
  members,
  meId,
  hasMore,
  onLoadOlder,
  onReact,
  onOpenThread,
  onDelete,
}: MessageListProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastId = messages.at(-1)?.id;

  // Scroll position is decided before paint, so a new message never shows the
  // list jumping after the fact.
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
      // Someone who has scrolled up is reading. Do not drag them back down.
      pinned.current = distance < 80;
      if (element.scrollTop < 200) onLoadOlder();
    }

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [onLoadOlder]);

  const visible = messages.filter((message) => message.parentId === null);

  return (
    <div ref={viewport} className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-5">
      {hasMore ? (
        <p className="text-text-muted py-2 text-center text-xs">Loading earlier messages</p>
      ) : (
        <p className="text-text-muted py-2 text-center text-xs">This is the start of the channel</p>
      )}

      <ol className="flex flex-col gap-0.5">
        {visible.map((message, index) => {
          const previous = visible[index - 1];
          const grouped =
            previous !== undefined &&
            previous.authorId === message.authorId &&
            message.createdAt - previous.createdAt < GROUPING_WINDOW_MS &&
            previous.deletedAt === null;

          return (
            <MessageRow
              key={message.id}
              message={message}
              members={members}
              meId={meId}
              grouped={grouped}
              onReact={onReact}
              onOpenThread={onOpenThread}
              onDelete={onDelete}
            />
          );
        })}
      </ol>
    </div>
  );
}

interface MessageRowProps {
  message: Message;
  members: MemberProfile[];
  meId: string;
  grouped: boolean;
  onReact(messageId: string, emoji: string, on: boolean): void;
  onOpenThread(messageId: string): void;
  onDelete(messageId: string): void;
}

function MessageRow({
  message,
  members,
  meId,
  grouped,
  onReact,
  onOpenThread,
  onDelete,
}: MessageRowProps) {
  const [picking, setPicking] = useState(false);
  const name = memberName(members, message.authorId);
  const pending = message.seq === Number.MAX_SAFE_INTEGER;

  if (message.deletedAt !== null) {
    return <li className="text-text-muted py-1 pl-11 text-sm italic">Message deleted</li>;
  }

  return (
    <li className="group hover:bg-surface-hover relative flex gap-3 rounded-lg px-1 py-0.5">
      <div className="w-8 shrink-0">
        {grouped ? null : <Avatar name={name} url={memberAvatar(members, message.authorId)} />}
      </div>

      <div className="min-w-0 flex-1">
        {grouped ? null : (
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{name}</span>
            <time
              dateTime={new Date(message.createdAt).toISOString()}
              className="text-text-muted text-2xs"
            >
              {formatTime(message.createdAt)}
            </time>
          </p>
        )}

        {/*
          An unsettled send is dimmed rather than spinner laden. It resolves in
          milliseconds and a spinner would flash.
        */}
        <div className={cx(pending && 'text-text-secondary')}>
          <MessageBody body={message.body} />
        </div>

        <Attachments attachments={message.attachments} />
        <Reactions
          reactions={message.reactions}
          meId={meId}
          onToggle={(emoji, on) => onReact(message.id, emoji, on)}
        />

        {message.replyCount > 0 ? (
          <button
            type="button"
            onClick={() => onOpenThread(message.id)}
            className="text-accent mt-1 text-xs"
          >
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        ) : null}
      </div>

      <div className="border-border bg-surface-raised shadow-popover absolute -top-3 right-2 flex items-center gap-0.5 rounded-lg border p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
        {QUICK_REACTIONS.map((emoji) => (
          <RowAction
            key={emoji}
            label={`React with ${emoji}`}
            onClick={() => onReact(message.id, emoji, true)}
          >
            <span className="text-sm">{emoji}</span>
          </RowAction>
        ))}

        <div className="relative">
          <RowAction
            label="Add a reaction"
            expanded={picking}
            onClick={() => setPicking((open) => !open)}
          >
            <Icon name="emoji" />
          </RowAction>
          {picking ? (
            <EmojiPicker
              onClose={() => setPicking(false)}
              onPick={(emoji) => {
                onReact(message.id, emoji, true);
                setPicking(false);
              }}
            />
          ) : null}
        </div>

        <RowAction label="Reply in thread" onClick={() => onOpenThread(message.id)}>
          <Icon name="reply" />
        </RowAction>

        {message.authorId === meId ? (
          <RowAction label="Delete message" onClick={() => onDelete(message.id)}>
            <Icon name="trash" />
          </RowAction>
        ) : null}
      </div>
    </li>
  );
}

/** The three people reach for constantly, so they cost one click rather than two. */
const QUICK_REACTIONS = ['\u{1f44d}', '\u{2705}', '\u{1f440}'];

function RowAction({
  label,
  onClick,
  expanded,
  children,
}: {
  label: string;
  onClick(): void;
  expanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
      className="text-text-muted hover:text-text-primary hover:bg-surface-active grid size-8 place-items-center rounded-md text-sm"
    >
      {children}
    </button>
  );
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
