import { Icon, type IconName } from '@huddle/ui';
import { useEffect, useRef } from 'react';

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

/**
 * What a hover strip becomes on a phone.
 *
 * Every action on a message lived behind hover, which does not exist on touch,
 * so none of them could be reached at all. This is the same set, arriving from
 * the bottom where a thumb already is, with the reactions on one row because
 * those are what people reach for.
 */
export function MessageSheet({ reactions, actions, onReact, onClose }: MessageSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="bg-surface-raised text-text-primary border-border mt-auto mb-0 w-full max-w-none rounded-t-2xl border p-0 backdrop:bg-black/40"
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
                  ref.current?.close();
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
              ref.current?.close();
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
