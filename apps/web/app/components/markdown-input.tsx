import { cx } from '@huddle/ui';
import {
  useLayoutEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { highlight, type Emphasis } from '../lib/highlight';

/**
 * A textarea with the markdown painted behind it.
 *
 * A real editor here would mean contenteditable, which breaks the mobile
 * keyboard, the input method editor and undo in ways nobody can fully repair.
 * So the textarea stays exactly what it is, with its text made transparent, and
 * a styled copy of the same characters sits underneath in the same box. The
 * caret, the selection and every keyboard behaviour are the platform's; only
 * the paint is ours.
 *
 * The two layers share one class list for everything that affects layout. They
 * have to wrap identically to the pixel, and the highlighter guarantees the
 * character stream is the same.
 */
const SHARED =
  'w-full px-3 py-2.5 text-base leading-message font-ui whitespace-pre-wrap break-words';

const STYLES: Record<Emphasis, string> = {
  plain: '',
  marker: 'text-text-muted',
  strong: 'font-semibold',
  emphasis: 'italic',
  strike: 'line-through',
  code: 'font-mono text-[0.95em] text-accent',
  link: 'text-accent underline decoration-1 underline-offset-2',
  mention: 'text-accent font-medium',
  quote: 'text-text-secondary italic',
};

interface MarkdownInputProps {
  value: string;
  placeholder: string;
  maxHeight: number;
  onChange(event: ChangeEvent<HTMLTextAreaElement>): void;
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
  onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void;
  onBlur(): void;
  onSelect(event: { currentTarget: HTMLTextAreaElement }): void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function MarkdownInput({
  value,
  placeholder,
  maxHeight,
  onChange,
  onKeyDown,
  onPaste,
  onBlur,
  onSelect,
  inputRef,
}: MarkdownInputProps) {
  const painted = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => highlight(value), [value]);

  // The field grows with its content, and the paint has to grow with it. Both
  // are set before the browser paints, so nothing is ever seen misaligned.
  useLayoutEffect(() => {
    const field = inputRef.current;
    const layer = painted.current;
    if (!field || !layer) return;

    field.style.height = 'auto';
    const chrome = field.offsetHeight - field.clientHeight;
    const wanted = field.scrollHeight + chrome;
    const height = Math.min(wanted, maxHeight);

    field.style.height = `${height}px`;
    field.style.overflowY = wanted > maxHeight ? 'auto' : 'hidden';
    layer.style.height = `${height}px`;
  }, [value, maxHeight, inputRef]);

  return (
    <div className="border-border bg-surface-sunken relative min-h-11 flex-1 rounded-xl border">
      <div
        ref={painted}
        aria-hidden
        // Scrolls with the field, so a long message stays aligned once the
        // textarea starts scrolling rather than growing.
        className={cx(SHARED, 'pointer-events-none absolute inset-0 overflow-hidden')}
      >
        {value === '' ? (
          <span className="text-text-muted">{placeholder}</span>
        ) : (
          segments.map((segment, index) => (
            <span key={index} className={STYLES[segment.style]}>
              {segment.text}
            </span>
          ))
        )}
        {/* A trailing newline has no height of its own, and without this the
            paint stops one line short of the caret. */}
        {value.endsWith('\n') ? ' ' : null}
      </div>

      <textarea
        ref={inputRef}
        value={value}
        rows={1}
        aria-label="Message"
        onChange={onChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={onBlur}
        onSelect={onSelect}
        onScroll={(event) => {
          if (painted.current) painted.current.scrollTop = event.currentTarget.scrollTop;
        }}
        className={cx(
          SHARED,
          // The glyphs come from the layer behind. The caret is painted from
          // the text colour, and the selection is translucent so the styled
          // text still reads through it.
          'selection:bg-accent/25 relative resize-none bg-transparent text-transparent caret-[color:var(--text-primary)] outline-none',
        )}
      />
    </div>
  );
}
