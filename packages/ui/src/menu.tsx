import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from './cx.js';
import { Icon, type IconName } from './icon.js';

/**
 * One dropdown for the whole app.
 *
 * It renders into the browser's top layer through the popover attribute, which
 * is the only way to be certain a menu is above everything: a stacking context
 * created by a transform or an overflow somewhere up the tree beats any
 * z-index you can write, and answering that with a bigger number never ends.
 * The top layer sits outside the page's stacking contexts entirely.
 *
 * Light dismiss, Escape, and closing when another popover opens all come from
 * the platform. What is added here is placement, which the platform does not
 * do outside Chromium yet, and the arrow key behaviour a menu is expected to
 * have.
 */

const SUPPORTED =
  typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');

/** Distance from the control, so the menu reads as attached to it. */
const GAP = 6;

/** Never let a menu touch the edge of the window. */
const MARGIN = 8;

interface MenuContext {
  open: boolean;
  id: string;
  toggle(): void;
  close(): void;
  setTrigger(node: HTMLElement | null): void;
}

const Context = createContext<MenuContext | null>(null);

function useMenu(): MenuContext {
  const value = useContext(Context);
  if (!value) throw new Error('MenuButton and MenuItem must be used inside a Menu.');
  return value;
}

export interface MenuProps {
  label: string;
  /** The control that opens it, which must be a MenuButton. */
  trigger: ReactNode;
  /** Which edge of the control the menu lines up with. */
  align?: 'start' | 'end';
  /** Preferred side. It flips when there is no room. */
  side?: 'bottom' | 'top';
  className?: string;
  children: ReactNode;
}

export function Menu({
  label,
  trigger,
  align = 'start',
  side = 'bottom',
  className,
  children,
}: MenuProps) {
  const id = useId();
  const [triggerNode, setTrigger] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((was) => !was), []);

  // The platform closes the popover for its own reasons: a click outside, the
  // Escape key, another popover opening. The toggle event is how that gets
  // back to React, so the two never disagree about whether it is open.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    const onToggle = (event: Event) => setOpen((event as ToggleEvent).newState === 'open');
    element.addEventListener('toggle', onToggle);
    return () => element.removeEventListener('toggle', onToggle);
  }, []);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;

    if (!open) {
      if (SUPPORTED && element.matches(':popover-open')) element.hidePopover();
      return;
    }

    if (SUPPORTED && !element.matches(':popover-open')) element.showPopover();
    place(element, triggerNode, align, side);

    // Focus lands on the menu itself rather than the first item, so opening it
    // does not read as having already chosen something.
    element.focus({ preventScroll: true });
  }, [open, triggerNode, align, side]);

  // A menu pinned to a control has to follow it, or it detaches the moment
  // anything behind it moves.
  useEffect(() => {
    if (!open) return;

    const reposition = () => {
      if (panel.current) place(panel.current, triggerNode, align, side);
    };

    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, triggerNode, align, side]);

  // Without popover support there is no light dismiss to inherit.
  useEffect(() => {
    if (!open || SUPPORTED) return;

    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (panel.current?.contains(target) || triggerNode?.contains(target)) return;
      setOpen(false);
    }

    const timer = setTimeout(() => document.addEventListener('mousedown', onPointer), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, triggerNode]);

  return (
    <Context.Provider value={{ open, id, toggle, close, setTrigger }}>
      {trigger}

      <div
        ref={panel}
        id={id}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        {...(SUPPORTED ? { popover: 'auto' } : {})}
        hidden={SUPPORTED ? undefined : !open}
        onKeyDown={(event) => onMenuKeys(event, close, triggerNode)}
        className={cx(
          'border-border bg-surface-raised shadow-popover text-text-primary fixed m-0 min-w-52 rounded-xl border p-1',
          SUPPORTED ? '' : 'z-50',
          'motion-safe:transition-[opacity,transform] motion-safe:duration-(--duration-instant)',
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
          className,
        )}
      >
        {children}
      </div>
    </Context.Provider>
  );
}

export type MenuButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'aria-haspopup' | 'aria-controls' | 'onClick' | 'type'
>;

/** The control that opens the menu. It carries the wiring so nothing else has to. */
export function MenuButton({ children, ...props }: MenuButtonProps) {
  const menu = useMenu();

  return (
    <button
      type="button"
      ref={menu.setTrigger}
      onClick={menu.toggle}
      aria-haspopup="menu"
      aria-expanded={menu.open}
      aria-controls={menu.id}
      {...props}
    >
      {children}
    </button>
  );
}

export interface MenuItemProps {
  icon?: IconName;
  /** Destructive actions are red, and never the first thing under the cursor. */
  danger?: boolean;
  disabled?: boolean;
  /** Shown on the right, for a shortcut or the current value. */
  hint?: string;
  selected?: boolean;
  /** For an item that changes something in place rather than going somewhere. */
  keepOpen?: boolean;
  onSelect(): void;
  children: ReactNode;
}

export function MenuItem({
  icon,
  danger = false,
  disabled = false,
  hint,
  selected = false,
  keepOpen = false,
  onSelect,
  children,
}: MenuItemProps) {
  const menu = useMenu();

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-checked={selected || undefined}
      onClick={() => {
        // Closed before the action runs, so a menu never lingers over the
        // screen it just navigated away from.
        if (!keepOpen) menu.close();
        onSelect();
      }}
      className={cx(
        'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm',
        'disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'text-critical hover:bg-critical-soft focus-visible:bg-critical-soft'
          : 'hover:bg-surface-hover focus-visible:bg-surface-hover',
      )}
    >
      {icon ? <Icon name={icon} className="size-4 shrink-0 opacity-80" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <Icon name="check" className="text-accent size-4 shrink-0" /> : null}
      {hint ? <span className="text-text-muted shrink-0 text-xs capitalize">{hint}</span> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <hr className="border-border my-1 border-t" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-text-muted text-2xs px-2.5 pt-2 pb-1 font-semibold tracking-wide uppercase">
      {children}
    </p>
  );
}

/**
 * Places the menu against its control, flipping and sliding rather than
 * hanging off the edge of the window.
 */
function place(
  element: HTMLElement,
  trigger: HTMLElement | null,
  align: 'start' | 'end',
  side: 'bottom' | 'top',
): void {
  if (!trigger) return;

  const anchor = trigger.getBoundingClientRect();
  const menu = element.getBoundingClientRect();

  const below = window.innerHeight - anchor.bottom - GAP;
  const above = anchor.top - GAP;
  const goesUp =
    side === 'top' ? above > menu.height || above > below : below < menu.height && above > below;

  const top = goesUp ? anchor.top - menu.height - GAP : anchor.bottom + GAP;
  const wanted = align === 'end' ? anchor.right - menu.width : anchor.left;

  const left = Math.min(Math.max(MARGIN, wanted), window.innerWidth - menu.width - MARGIN);
  const clamped = Math.min(Math.max(MARGIN, top), window.innerHeight - menu.height - MARGIN);

  element.style.left = `${String(Math.round(left))}px`;
  element.style.top = `${String(Math.round(clamped))}px`;
}

/** Arrow keys move, Escape leaves, and focus returns to where it came from. */
function onMenuKeys(
  event: React.KeyboardEvent<HTMLDivElement>,
  close: () => void,
  trigger: HTMLElement | null,
): void {
  if (event.key === 'Escape' || event.key === 'Tab') {
    close();
    trigger?.focus();
    return;
  }

  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'),
  ];
  if (items.length === 0) return;

  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);

  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (at + 1) % items.length
          : (at <= 0 ? items.length : at) - 1;

  items[next]?.focus();
}
