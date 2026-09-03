import type { MemberProfile } from '@huddle/core';
import { useCallback, useMemo, useState } from 'react';
import { handleOf } from './rich-text';

export interface MentionQuery {
  /** Where the `@` sits, so the token can be replaced exactly. */
  start: number;
  text: string;
}

export interface Mentions {
  matches: MemberProfile[];
  active: number;
  open: boolean;
  /** Call on every change of the field, with the caret position. */
  update(value: string, caret: number): void;
  move(direction: 1 | -1): void;
  close(): void;
  /** Returns the new value and where the caret should land, or null. */
  choose(value: string, member?: MemberProfile): { value: string; caret: number } | null;
}

const LIMIT = 6;

/**
 * A token is only a mention while the caret is still inside it and it holds no
 * space, so an email address someone typed mid sentence does not open a picker
 * and neither does an `@` from three words ago.
 */
function tokenAt(value: string, caret: number): MentionQuery | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;

  // Must start a word: `@ada` yes, `me@example.com` no.
  const preceding = at === 0 ? ' ' : (before[at - 1] ?? ' ');
  if (!/\s/.test(preceding)) return null;

  const text = before.slice(at + 1);
  if (/\s/.test(text)) return null;

  return { start: at, text };
}

export function useMentions(members: MemberProfile[]): Mentions {
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (query === null) return [];

    const needle = query.text.toLowerCase();
    return members
      .filter(
        (member) =>
          needle === '' ||
          handleOf(member.displayName).startsWith(needle) ||
          member.displayName.toLowerCase().includes(needle),
      )
      .slice(0, LIMIT);
  }, [members, query]);

  const update = useCallback((value: string, caret: number) => {
    setQuery(tokenAt(value, caret));
    setActive(0);
  }, []);

  const move = useCallback(
    (direction: 1 | -1) => {
      setActive((current) => {
        const count = matches.length;
        if (count === 0) return 0;
        return (current + direction + count) % count;
      });
    },
    [matches.length],
  );

  const close = useCallback(() => setQuery(null), []);

  const choose = useCallback<Mentions['choose']>(
    (value, member) => {
      const picked = member ?? matches[active];
      if (query === null || picked === undefined) return null;

      const handle = `@${handleOf(picked.displayName)} `;
      const next =
        value.slice(0, query.start) + handle + value.slice(query.start + 1 + query.text.length);

      setQuery(null);
      return { value: next, caret: query.start + handle.length };
    },
    [active, matches, query],
  );

  return {
    matches,
    active,
    open: query !== null && matches.length > 0,
    update,
    move,
    close,
    choose,
  };
}
