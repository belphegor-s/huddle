import { cx, Icon, type IconName } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';

export interface SheetAction {
  label: string;
  icon: IconName;
  destructive?: boolean;
  run(): void;
}

interface MessageSheetProps {
  reactions: string[];
  actions: SheetAction[];
  onReact(emoji: string): void;
  onClose(): void;
}

/** Matches --duration-exit, which is how long the slide down is drawn for. */
const EXIT_MS = 140;

/**
 * What a hover strip becomes on a phone.
 *
 * Every action on a message lived behind hover, which does not exist on touch,
 * so none of them could be reached at all. This is the same set, arriving from
 * the bottom where a thumb already is, with the reactions on one row because
 * those are what people reach for.
 *
 * The leave is drawn the way out of a sheet is: down and away, faster than it
 * came, and the dialog is only closed once that has run. Closing it first would
 * take it out of the top layer with nothing left to animate.
 */
export function MessageSheet({ reactions, actions, onReact, onClose }: MessageSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function dismiss() {
    if (leaving) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === ref.current) dismiss();
      }}
      className={cx(
        'bg-surface-raised text-text-primary border-border mt-auto mb-0 w-full max-w-none rounded-t-2xl border p-0',
        'backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
        open ? 'backdrop:opacity-100' : 'backdrop:opacity-0',
        'motion-safe:transition-[opacity,transform] motion-safe:backdrop:transition-opacity',
        open
          ? 'motion-safe:duration-(--duration-sheet) motion-safe:[transition-timing-function:var(--ease-out-settle)] motion-safe:backdrop:duration-(--duration-settle)'
          : 'motion-safe:duration-(--duration-exit) motion-safe:[transition-timing-function:var(--ease-in-quick)] motion-safe:backdrop:duration-(--duration-exit)',
        open ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0',
      )}
    >
      <div className="flex flex-col gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <span aria-hidden className="bg-border-strong mx-auto mb-1 h-1 w-9 rounded-full" />

        <ul className="border-border flex justify-around border-b pb-2">
          {reactions.map((emoji) => (
            <li key={emoji}>
              <button
                type="button"
                aria-label={`React with ${emoji}`}
                onClick={() => {
                  onReact(emoji);
                  dismiss();
                }}
                className="hover:bg-surface-hover grid size-12 place-items-center rounded-full text-xl"
              >
                {emoji}
              </button>
            </li>
          ))}
        </ul>

        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              action.run();
              dismiss();
            }}
            className={
              action.destructive
                ? 'text-critical hover:bg-surface-hover flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-sm'
                : 'hover:bg-surface-hover flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-sm'
            }
          >
            <Icon name={action.icon} className="size-4" />
            {action.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}
