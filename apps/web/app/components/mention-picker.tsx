import type { MemberProfile } from '@huddle/core';
import { Avatar, cx } from '@huddle/ui';
import { handleOf } from '../lib/rich-text';

interface MentionPickerProps {
  matches: MemberProfile[];
  active: number;
  onPick(member: MemberProfile): void;
}

/**
 * Sits above the composer rather than over the conversation, so choosing
 * somebody never hides what is being replied to.
 *
 * Keyboard driven: the list is decoration for the arrow keys, which is why the
 * whole thing is presentational and the textarea keeps focus throughout.
 */
export function MentionPicker({ matches, active, onPick }: MentionPickerProps) {
  return (
    <ul
      role="listbox"
      aria-label="People you can mention"
      className="border-border bg-surface-raised shadow-popover absolute right-3 bottom-full left-3 z-20 mb-2 flex max-h-64 flex-col overflow-y-auto rounded-xl border p-1 md:right-5 md:left-5"
    >
      {matches.map((member, index) => (
        <li key={member.id}>
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            // The textarea must keep focus, so the press is handled before
            // the browser has a chance to move it.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(member);
            }}
            className={cx(
              'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm',
              index === active ? 'bg-surface-active' : 'hover:bg-surface-hover',
            )}
          >
            <Avatar name={member.displayName} url={member.avatarUrl} size="sm" />
            <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
            <span className="text-text-muted truncate text-xs">
              @{handleOf(member.displayName)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
