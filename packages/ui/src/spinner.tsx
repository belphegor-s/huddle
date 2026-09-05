import { cx } from './cx.js';

export interface SpinnerProps {
  className?: string;
  /** Announced to a screen reader. Omit inside an element that already says it. */
  label?: string;
}

/**
 * Work in progress, drawn rather than animated with a GIF.
 *
 * Under reduced motion it stops turning and becomes a static ring, which still
 * reads as "not finished" without the spin. A disabled animation that leaves
 * nothing behind is the failure mode to avoid.
 */
export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx(
        'inline-block size-4 rounded-full border-2 border-current border-t-transparent',
        'motion-safe:animate-spin motion-reduce:border-t-current motion-reduce:opacity-60',
        className,
      )}
    />
  );
}
