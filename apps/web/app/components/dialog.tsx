import { useEffect, useRef, useState } from 'react';
import { cx } from '@huddle/ui';

interface DialogProps {
  title: string;
  onClose(): void;
  children: React.ReactNode;
}

/** Long enough to be seen, short enough never to be in the way. */
const EXIT_MS = 140;

/**
 * The platform dialog, not a div with a high z-index. It brings focus
 * trapping, inertness of the page behind it, Escape to dismiss and the top
 * layer for free, and all four are things a hand rolled overlay gets wrong.
 *
 * Closing is animated, which a native dialog makes awkward: `close()` removes
 * it from the top layer immediately, so there is nothing left to animate. The
 * dialog is therefore told to leave, drawn on its way out, and closed for real
 * once the animation has run. Under reduced motion it simply goes.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
    // On the next frame, so the browser has a closed state to animate from.
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function dismiss() {
    if (leaving) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      ref.current?.close();
      return;
    }

    setLeaving(true);
    setOpen(false);
    setTimeout(() => ref.current?.close(), EXIT_MS);
  }

  return (
    <dialog
      ref={ref}
      // Named, so a screen reader announces what opened rather than just
      // "dialog", and so it can be addressed by name at all.
      aria-label={title}
      onClose={onClose}
      onCancel={(event) => {
        // Escape closes it instantly by default, which skips the way out.
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        // A click that lands on the dialog element itself is a click on the
        // backdrop, because the content sits in a child.
        if (event.target === ref.current) dismiss();
      }}
      className={cx(
        'bg-surface-raised text-text-primary border-border shadow-popover m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border p-0',
        'backdrop:bg-black/40 motion-safe:backdrop:transition-opacity motion-safe:backdrop:duration-150',
        open ? 'backdrop:opacity-100' : 'backdrop:opacity-0',
        'motion-safe:transition-[opacity,transform] motion-safe:duration-150',
        // A slight rise and settle, on the same curve the rest of the app uses
        // when something arrives.
        'motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)]',
        open ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1 scale-[0.98] opacity-0',
      )}
    >
      <div className="flex flex-col gap-5 p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
