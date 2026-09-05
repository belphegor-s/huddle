import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.js';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'children'
> {
  label: ReactNode;
  /** The line under it, for a choice that needs explaining. */
  hint?: ReactNode;
}

/**
 * A checkbox that matches the rest of the app.
 *
 * The native control is still there, doing all the work: focus, the keyboard,
 * the form value, and what a screen reader announces. It is made invisible and
 * a box is drawn beside it, so nothing about how it behaves is reimplemented,
 * only how it looks.
 *
 * The tick is drawn with a stroke that runs on when it appears, which reads as
 * the box agreeing with you rather than a state swapping underneath.
 */
export function Checkbox({ label, hint, className, disabled, ...props }: CheckboxProps) {
  return (
    <label
      className={cx(
        'group flex gap-2 text-sm',
        // A single line centres on the box. Only a two line choice needs the
        // box pinned to the top, and centring that would leave it floating
        // beside the middle of the sentence.
        hint ? 'items-start' : 'items-center',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <input type="checkbox" disabled={disabled} className="peer sr-only" {...props} />

      <span
        aria-hidden
        className={cx(
          'grid size-[1.125rem] shrink-0 place-items-center rounded border transition-colors',
          hint ? 'mt-0.5' : '',
          'border-border-strong bg-surface',
          'peer-checked:border-accent peer-checked:bg-accent',
          'peer-focus-visible:outline-focus-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
          'group-hover:border-accent',
          /*
           * The tick lives inside this span, and peer-checked only reaches
           * siblings of the input. Styling it from here, through a descendant
           * selector, is what makes it appear at all.
           */
          'peer-checked:[&_path]:[stroke-dashoffset:0]',
        )}
      >
        <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden>
          <path
            d="M3.5 8.5 6.5 11.5 12.5 5"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cx(
              'text-on-accent',
              // Drawn on rather than faded in, so the box reads as agreeing
              // with you. Reduced motion gets the finished tick immediately.
              '[stroke-dasharray:14] [stroke-dashoffset:14]',
              'motion-safe:transition-[stroke-dashoffset] motion-safe:duration-200 motion-safe:ease-out',
              'motion-reduce:transition-none',
            )}
          />
        </svg>
      </span>

      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint ? <span className="text-text-muted block text-xs">{hint}</span> : null}
      </span>
    </label>
  );
}
