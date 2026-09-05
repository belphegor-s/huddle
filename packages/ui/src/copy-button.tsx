import { useEffect, useRef, useState } from 'react';
import { cx } from './cx.js';
import { Icon } from './icon.js';

export interface CopyButtonProps {
  /** The text that lands on the clipboard. */
  value: string;
  /**
   * What is being taken, as it reads after the verb: "the address", "the
   * invite link". The control names itself from it, so no caller has to write
   * the same two labels again.
   */
  what: string;
  className?: string;
}

/** Long enough to be seen, short enough that the button is ready again. */
const SETTLE_MS = 1500;

/**
 * One press, and the value is on the clipboard.
 *
 * Every place that hands somebody a string to take uses this, so the icon, the
 * confirmation and the words a screen reader gets are the same everywhere
 * rather than three near misses.
 */
export function CopyButton({ value, what, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  function settle() {
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), SETTLE_MS);
  }

  async function copy() {
    /*
     * The clipboard API needs a secure context, and this is a product people
     * run on a plain http address on their own network. Where it is missing or
     * refuses, the old selection trick still works, and a copy button that
     * does nothing on half the installs would be worse than a deprecation.
     */
    try {
      await navigator.clipboard.writeText(value);
      settle();
      return;
    } catch {
      // Falls through.
    }

    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(field);
    field.select();

    try {
      if (document.execCommand('copy')) settle();
    } finally {
      field.remove();
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : `Copy ${what}`}
      title={copied ? 'Copied' : `Copy ${what}`}
      onClick={() => void copy()}
      className={cx(
        'text-text-muted hover:bg-surface-hover hover:text-text-primary grid size-9 shrink-0 place-items-center rounded-md transition-colors',
        className,
      )}
    >
      <Icon name={copied ? 'check' : 'copy'} className={cx('size-4', copied && 'text-accent')} />
    </button>
  );
}
