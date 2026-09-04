import { useEffect, useRef } from 'react';

interface DialogProps {
  title: string;
  onClose(): void;
  children: React.ReactNode;
}

/**
 * The platform dialog, not a div with a high z-index. It brings focus
 * trapping, inertness of the page behind it, Escape to dismiss and the top
 * layer for free, and all four are things a hand rolled overlay gets wrong.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      // Named, so a screen reader announces what opened rather than just
      // "dialog", and so it can be addressed by name at all.
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the dialog element itself is a click on the
        // backdrop, because the content sits in a child.
        if (event.target === ref.current) ref.current?.close();
      }}
      className="bg-surface-raised text-text-primary border-border shadow-popover m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border p-0 backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-5 p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
