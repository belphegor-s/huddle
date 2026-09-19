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
import { aim, place, POPOVER_SUPPORTED, type Align, type Side } from './overlay.js';

/**
 * A floating panel that is not a list of choices.
 *
 * Menu is the right thing for a list of items. This is for the rest: a grid of
 * reactions, a small form, anything that needs the top layer and correct
 * placement without pretending to be a menu for a screen reader.
 */

interface PopoverContext {
  open: boolean;
  id: string;
  toggle(): void;
  close(): void;
  setTrigger(node: HTMLElement | null): void;
}

const Context = createContext<PopoverContext | null>(null);

export function usePopover(): PopoverContext {
  const value = useContext(Context);
  if (!value) throw new Error('PopoverButton must be used inside a Popover.');
  return value;
}

export interface PopoverProps {
  label: string;
  trigger: ReactNode;
  align?: Align;
  side?: Side;
  className?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}

export function Popover({
  label,
  trigger,
  align = 'start',
  side = 'bottom',
  className,
  children,
}: PopoverProps) {
  const id = useId();
  const [triggerNode, setTrigger] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((was) => !was), []);

  const settle = useCallback(() => {
    const element = panel.current;
    if (!element) return;

    aim(element, place(element, triggerNode, align, side));
  }, [triggerNode, align, side]);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    // Placed here rather than from the render this event schedules, for the
    // reason in Menu: the panel is in the top layer already.
    const onToggle = (event: Event) => {
      const opening = (event as ToggleEvent).newState === 'open';
      if (opening) settle();
      setOpen(opening);
    };

    element.addEventListener('toggle', onToggle);
    return () => element.removeEventListener('toggle', onToggle);
  }, [settle]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;

    if (!open) {
      if (POPOVER_SUPPORTED && element.matches(':popover-open')) element.hidePopover();
      return;
    }

    if (POPOVER_SUPPORTED && !element.matches(':popover-open')) {
      // Aimed before it is shown, for the reason in Menu.
      aim(element, side);
      element.showPopover();
    }
    settle();
    element.focus({ preventScroll: true });
  }, [open, side, settle]);

  useEffect(() => {
    if (!open) return;

    window.addEventListener('scroll', settle, true);
    window.addEventListener('resize', settle);
    return () => {
      window.removeEventListener('scroll', settle, true);
      window.removeEventListener('resize', settle);
    };
  }, [open, settle]);

  // Without popover support there is no light dismiss to inherit.
  useEffect(() => {
    if (!open || POPOVER_SUPPORTED) return;

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
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        {...(POPOVER_SUPPORTED ? { popover: 'auto' } : {})}
        hidden={POPOVER_SUPPORTED ? undefined : !open}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          close();
          triggerNode?.focus();
        }}
        // Motion comes from motion.css through :popover-open, for the reason
        // given in Menu.
        className={cx(
          'border-border bg-surface-raised shadow-popover text-text-primary fixed m-0 rounded-xl border p-1.5',
          open ? '' : 'pointer-events-none',
          POPOVER_SUPPORTED ? '' : cx('z-50', open ? 'opacity-100' : 'opacity-0'),
          className,
        )}
      >
        {typeof children === 'function' ? children(close) : children}
      </div>
    </Context.Provider>
  );
}

export type PopoverButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'aria-haspopup' | 'aria-controls' | 'onClick' | 'type'
>;

export function PopoverButton({ children, ...props }: PopoverButtonProps) {
  const popover = usePopover();

  return (
    <button
      type="button"
      ref={popover.setTrigger}
      // The browser toggles it where it can, for the reason in MenuButton.
      {...(POPOVER_SUPPORTED ? { popoverTarget: popover.id } : { onClick: popover.toggle })}
      aria-haspopup="dialog"
      aria-expanded={popover.open}
      aria-controls={popover.id}
      {...props}
    >
      {children}
    </button>
  );
}
