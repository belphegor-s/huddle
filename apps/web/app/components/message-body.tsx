import type { MemberProfile } from '@huddle/core';
import { cx } from '@huddle/ui';
import { useMemo } from 'react';
import { handleOf, toLines } from '../lib/rich-text';

interface MessageBodyProps {
  body: string;
  members: MemberProfile[];
  meId: string;
}

const MENTION = /(@[\w.-]{1,80})/g;

/**
 * Renders a message body as text nodes. The body is stored as TipTap JSON and
 * is never trusted as markup, so nothing here can turn message content into an
 * element.
 *
 * A mention that reads as ordinary text is a mention nobody notices, and one
 * aimed at you should be findable while scrolling past, so yours is the only
 * one that carries the accent.
 */
export function MessageBody({ body, members, meId }: MessageBodyProps) {
  const handles = useMemo(() => {
    const map = new Map<string, MemberProfile>();
    for (const member of members) map.set(handleOf(member.displayName), member);
    return map;
  }, [members]);

  return (
    <div className="leading-message text-base whitespace-pre-wrap">
      {toLines(body).map((line, index) => (
        <p key={index}>{line === '' ? ' ' : render(line, handles, meId)}</p>
      ))}
    </div>
  );
}

function render(line: string, handles: Map<string, MemberProfile>, meId: string) {
  return line.split(MENTION).map((part, index) => {
    if (!part.startsWith('@')) return part;

    const member = handles.get(part.slice(1).toLowerCase());
    if (!member) return part;

    return (
      <span
        key={index}
        className={cx(
          'rounded-xs px-0.5 font-medium',
          member.id === meId ? 'bg-accent-soft text-accent' : 'text-accent',
        )}
      >
        @{member.displayName}
      </span>
    );
  });
}
