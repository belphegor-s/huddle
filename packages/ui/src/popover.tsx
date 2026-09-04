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
import { place, POPOVER_SUPPORTED, type Align, type Side } from './overlay.js';

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
      if (POPOVER_SUPPORTED && element.matches(':popover-open')) element.hidePopover();
      return;
    }

    if (POPOVER_SUPPORTED && !element.matches(':popover-open')) element.showPopover();
    place(element, triggerNode, align, side);
    element.focus({ preventScroll: true });
  }, [open, triggerNode, align, side]);

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
        className={cx(
          'border-border bg-surface-raised shadow-popover text-text-primary fixed m-0 rounded-xl border p-1.5',
          POPOVER_SUPPORTED ? '' : 'z-50',
          'motion-safe:transition-[opacity,transform] motion-safe:duration-(--duration-instant)',
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
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
      onClick={popover.toggle}
      aria-haspopup="dialog"
      aria-expanded={popover.open}
      aria-controls={popover.id}
      {...props}
    >
      {children}
    </button>
  );
}
