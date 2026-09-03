import { useRef } from 'react';
import { useDismiss } from '../lib/use-dismiss';

/**
 * A curated grid, not the full Unicode set.
 *
 * A complete picker means shipping an emoji index and usually a sprite sheet
 * from someone else's CDN, which the privacy rule forbids and which nobody
 * needs to say yes to a message. These are the reactions people actually send,
 * rendered by the system font like every other emoji in the app.
 */
const CHOICES = [
  '\u{1f44d}',
  '\u{2705}',
  '\u{1f440}',
  '\u{1f389}',
  '\u{1f525}',
  '\u{2764}\u{fe0f}',
  '\u{1f602}',
  '\u{1f62e}',
  '\u{1f622}',
  '\u{1f621}',
  '\u{1f64f}',
  '\u{1f4af}',
  '\u{1f680}',
  '\u{1f41b}',
  '\u{26a0}\u{fe0f}',
  '\u{1f6a2}',
  '\u{1f9e0}',
  '\u{1f4a1}',
  '\u{1f44b}',
  '\u{1f91d}',
  '\u{1f44f}',
  '\u{1f914}',
  '\u{1f971}',
  '\u{1f440}',
];

interface EmojiPickerProps {
  onPick(emoji: string): void;
  onClose(): void;
}

export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const panel = useRef<HTMLDivElement>(null);

  useDismiss(panel, onClose);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Pick a reaction"
      className="border-border bg-surface-raised shadow-popover absolute top-8 right-0 z-20 grid w-56 grid-cols-6 gap-0.5 rounded-xl border p-1.5"
    >
      {CHOICES.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          aria-label={`React with ${emoji}`}
          className="hover:bg-surface-hover grid size-8 place-items-center rounded-md text-base"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
