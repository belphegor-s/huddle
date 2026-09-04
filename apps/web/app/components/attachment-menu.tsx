import { Icon, Menu, MenuButton, MenuItem, type IconName } from '@huddle/ui';
import { useRef } from 'react';

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
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  return (
    <>
      <Menu
        label="Attach"
        side="top"
        className="w-60"
        trigger={
          <MenuButton
            aria-label="Attach"
            title="Attach"
            className="border-border bg-surface-raised hover:bg-surface-hover grid size-11 shrink-0 place-items-center rounded-xl border transition-colors"
          >
            <Icon name="attach" />
          </MenuButton>
        }
      >
        <>
          {CHOICES.map((choice, index) => (
            <MenuItem
              key={choice.label}
              icon={choice.icon}
              hint={choice.hint}
              onSelect={() => inputs.current[index]?.click()}
            >
              {choice.label}
            </MenuItem>
          ))}
        </>
      </Menu>

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
    </>
  );
}
