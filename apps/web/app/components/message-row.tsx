import type { MemberProfile, Message } from '@huddle/core';
import { Avatar, cx, Icon } from '@huddle/ui';
import { useMemo, useState } from 'react';
import { formatClock, formatTime } from '../lib/format';
import { toLines } from '../lib/rich-text';
import { useLongPress } from '../lib/use-long-press';
import { memberAvatar, memberName } from '../lib/workspace';
import { Attachments } from './attachments';
import { EmojiPicker } from './emoji-picker';
import { LinkPreviews } from './link-previews';
import { MessageBody } from './message-body';
import { MessageEditor } from './message-editor';
import { MessageSheet, type SheetAction } from './message-sheet';
import { Reactions } from './reactions';

/** A message the server has not acknowledged yet sorts after everything real. */
const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

/** The three people reach for constantly, so they cost one click rather than two. */
const QUICK_REACTIONS = ['\u{1f44d}', '\u{2705}', '\u{1f440}'];

export interface MessageRowProps {
  message: Message;
  members: MemberProfile[];
  meId: string;
  canModerate: boolean;
  grouped: boolean;
  onReact(messageId: string, emoji: string, on: boolean): void;
  onOpenThread(messageId: string): void;
  onEdit(messageId: string, text: string): Promise<void>;
  onDelete(messageId: string): void;
}

export function MessageRow({
  message,
  members,
  meId,
  canModerate,
  grouped,
  onReact,
  onOpenThread,
  onEdit,
  onDelete,
}: MessageRowProps) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const hold = useLongPress(() => setSheet(true));

  const source = useMemo(() => toLines(message.body).join('\n'), [message.body]);
  const name = memberName(members, message.authorId);
  const pending = message.seq === PENDING_SEQ;
  const mine = message.authorId === meId;

  if (message.deletedAt !== null) {
    return <li className="text-text-muted py-1 pl-12 text-sm italic">Message deleted</li>;
  }

  const actions: SheetAction[] = [
    { label: 'Reply in thread', icon: 'reply', run: () => onOpenThread(message.id) },
    ...(mine
      ? [{ label: 'Edit message', icon: 'edit' as const, run: () => setEditing(true) }]
      : []),
    ...(mine || canModerate
      ? [
          {
            label: 'Delete message',
            icon: 'trash' as const,
            destructive: true,
            run: () => onDelete(message.id),
          },
        ]
      : []),
  ];

  return (
    <li
      {...hold}
      className="group hover:bg-surface-hover relative flex gap-3 rounded-lg px-1 py-0.5"
    >
      <div className="w-8 shrink-0">
        {grouped ? (
          <time
            dateTime={new Date(message.createdAt).toISOString()}
            className="text-text-muted text-2xs block pt-1 text-right whitespace-nowrap tabular-nums opacity-0 transition-opacity group-hover:opacity-100"
          >
            {formatClock(message.createdAt)}
          </time>
        ) : (
          <Avatar name={name} url={memberAvatar(members, message.authorId)} />
        )}
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

        {editing ? (
          <MessageEditor
            initial={source}
            onCancel={() => setEditing(false)}
            onSave={async (text) => {
              await onEdit(message.id, text);
              setEditing(false);
            }}
          />
        ) : (
          <>
            {/*
              An unsettled send is dimmed rather than spinner laden. It resolves
              in milliseconds and a spinner would flash.
            */}
            <div className={cx(pending && 'text-text-secondary')}>
              <MessageBody source={source} members={members} meId={meId} />
              {message.editedAt === null ? null : (
                <span className="text-text-muted text-2xs ml-1">edited</span>
              )}
            </div>

            <Attachments attachments={message.attachments} />
            <LinkPreviews source={source} />
          </>
        )}

        <Reactions
          reactions={message.reactions}
          meId={meId}
          onToggle={(emoji, on) => onReact(message.id, emoji, on)}
        />

        {message.replyCount > 0 ? (
          <button
            type="button"
            onClick={() => onOpenThread(message.id)}
            className="text-accent hover:bg-accent-soft mt-1 flex items-center gap-1.5 rounded-md py-0.5 pr-2 text-xs font-medium"
          >
            <Icon name="thread" className="size-3.5" />
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        ) : null}
      </div>

      {/*
        Where there is no hover there is a button, always visible, because a
        long press is a gesture and a gesture on its own is undiscoverable. The
        press is the accelerator, not the only way in.
      */}
      {pending || editing ? null : (
        <button
          type="button"
          aria-label="Message actions"
          onClick={() => setSheet(true)}
          className="text-text-muted absolute top-1 right-1 hidden size-9 place-items-center rounded-lg [@media(hover:none)]:grid"
        >
          <Icon name="more" className="size-4" />
        </button>
      )}

      {/*
        Hover only, and hidden entirely where there is no hover. On touch the
        same actions arrive from the bottom, which is where a thumb already is.
      */}
      {pending || editing ? null : (
        <div className="border-border bg-surface-raised shadow-popover absolute -top-3 right-2 hidden items-center gap-0.5 rounded-lg border p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:hover)]:flex">
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

          {mine ? (
            <RowAction label="Edit message" onClick={() => setEditing(true)}>
              <Icon name="edit" />
            </RowAction>
          ) : null}

          {mine || canModerate ? (
            <RowAction label="Delete message" onClick={() => onDelete(message.id)}>
              <Icon name="trash" />
            </RowAction>
          ) : null}
        </div>
      )}
      {sheet ? (
        <MessageSheet
          reactions={QUICK_REACTIONS}
          actions={actions}
          onReact={(emoji) => onReact(message.id, emoji, true)}
          onClose={() => setSheet(false)}
        />
      ) : null}
    </li>
  );
}

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
