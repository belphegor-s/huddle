import { cx, Icon, type IconName } from '@huddle/ui';
import { useRef, useState } from 'react';
import { useDismiss } from '../lib/use-dismiss';

interface AttachmentMenuProps {
  onFiles(files: FileList): void;
}

/**
 * Two pickers, not one.
 *
 * A single file dialog on a phone opens the whole filesystem, when nine times
 * out of ten somebody wants the photo they took a minute ago. The accept hints
 * are what make the operating system offer the camera roll for one and the
 * document browser for the other.
 */
const CHOICES: Array<{ label: string; hint: string; icon: IconName; accept: string }> = [
  {
    label: 'Photo or video',
    hint: 'From your library or camera',
    icon: 'image',
    accept: 'image/*,video/*',
  },
  {
    label: 'Document',
    hint: 'Any other file',
    icon: 'file',
    accept: '',
  },
];

export function AttachmentMenu({ onFiles }: AttachmentMenuProps) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useDismiss(panel, () => setOpen(false));

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        aria-label="Attach"
        title="Attach"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((was) => !was)}
        className={cx(
          'border-border bg-surface-raised hover:bg-surface-hover grid size-11 shrink-0 place-items-center rounded-xl border transition-colors',
          open && 'bg-surface-active',
        )}
      >
        <Icon name="attach" />
      </button>

      {open ? (
        <div
          role="menu"
          className="border-border bg-surface-raised shadow-popover absolute bottom-13 left-0 z-30 flex w-60 flex-col rounded-xl border p-1"
        >
          {CHOICES.map((choice, index) => (
            <button
              key={choice.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                inputs.current[index]?.click();
              }}
              className="hover:bg-surface-hover flex min-h-12 items-center gap-3 rounded-lg px-2 text-left"
            >
              <span className="bg-surface-sunken text-text-secondary grid size-9 shrink-0 place-items-center rounded-lg">
                <Icon name={choice.icon} className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm">{choice.label}</span>
                <span className="text-text-muted block text-xs">{choice.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {CHOICES.map((choice, index) => (
        <input
          key={choice.label}
          ref={(node) => {
            inputs.current[index] = node;
          }}
          type="file"
          multiple
          hidden
          {...(choice.accept === '' ? {} : { accept: choice.accept })}
          onChange={(event) => {
            if (event.target.files && event.target.files.length > 0) onFiles(event.target.files);
            event.target.value = '';
          }}
        />
      ))}
    </div>
  );
}
