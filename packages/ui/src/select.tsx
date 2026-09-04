import { cx } from './cx.js';
import { Icon } from './icon.js';
import { Menu, MenuButton, MenuItem } from './menu.js';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange(value: T): void;
  className?: string;
}

/**
 * A dropdown that matches the rest of the app.
 *
 * A native select cannot be styled to match anything, renders as an operating
 * system widget that ignores the page's own dark mode, and on a phone opens a
 * wheel. This is the same menu everything else uses, so a filter and a role
 * picker look and behave like every other list of choices here.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SelectProps<T>) {
  const current = options.find((option) => option.value === value);

  return (
    <Menu
      label={label}
      className="min-w-56"
      trigger={
        <MenuButton
          aria-label={label}
          className={cx(
            'border-border bg-surface hover:bg-surface-hover flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm',
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? label}</span>
          <Icon name="chevronDown" className="text-text-muted size-4 shrink-0" />
        </MenuButton>
      }
    >
      <>
        {options.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === value}
            hint={option.hint}
            onSelect={() => onChange(option.value)}
          >
            {option.label}
          </MenuItem>
        ))}
      </>
    </Menu>
  );
}
