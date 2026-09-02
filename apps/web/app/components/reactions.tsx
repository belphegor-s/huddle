import type { Reaction } from '@huddle/core';
import { cx } from '@huddle/ui';

interface ReactionsProps {
  reactions: Reaction[];
  meId: string;
  onToggle(emoji: string, on: boolean): void;
}

export function Reactions({ reactions, meId, onToggle }: ReactionsProps) {
  if (reactions.length === 0) return null;

  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {reactions.map((reaction) => {
        const mine = reaction.userIds.includes(meId);
        return (
          <li key={reaction.emoji}>
            <button
              type="button"
              onClick={() => onToggle(reaction.emoji, !mine)}
              aria-pressed={mine}
              className={cx(
                'flex min-h-7 items-center gap-1 rounded-full border px-2 text-xs',
                mine
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface-raised text-text-secondary',
              )}
            >
              <span aria-hidden>{reaction.emoji}</span>
              <span>{reaction.userIds.length}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
