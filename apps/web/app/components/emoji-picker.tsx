import { Icon, Popover, PopoverButton } from '@huddle/ui';

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
  /** The class the trigger wears, so it matches the row it sits in. */
  triggerClassName?: string;
}

/**
 * The panel lives in the top layer rather than absolutely positioned beside
 * the message. It used to be clipped by the scrolling list it sat inside, and
 * covered by anything with a higher z-index, which is a fight no number wins.
 */
export function EmojiPicker({ onPick, triggerClassName }: EmojiPickerProps) {
  return (
    <Popover
      label="Pick a reaction"
      align="end"
      className="w-56"
      trigger={
        <PopoverButton
          aria-label="Add a reaction"
          title="Add a reaction"
          className={triggerClassName}
        >
          <Icon name="emoji" className="size-4" />
        </PopoverButton>
      }
    >
      {(close) => (
        <div className="grid grid-cols-6 gap-0.5">
          {CHOICES.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                close();
                onPick(emoji);
              }}
              aria-label={`React with ${emoji}`}
              className="hover:bg-surface-hover grid size-8 place-items-center rounded-md text-base"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
