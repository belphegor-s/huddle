import {
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

/** Long enough not to fire while a pointer crosses the control on its way past. */
const OPEN_DELAY_MS = 350;

export interface TooltipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** What the control does, in the fewest words that say it. */
  label: string;
  align?: Align;
  side?: Side;
  children: ReactNode;
}

/**
 * A label that appears on hover, and on focus, which the native `title`
 * attribute never does.
 *
 * It renders in the top layer like every other floating thing here, so it is
 * never clipped by a sidebar's overflow or covered by a panel. The popover is
 * manual rather than auto: an automatic one dismisses every other popover when
 * it opens, and a tooltip appearing would close the menu underneath it.
 *
 * The control keeps its own accessible name. This describes it rather than
 * naming it, so a screen reader is not handed the same words twice.
 */
export function Tooltip({
  label,
  align = 'start',
  side = 'bottom',
  children,
  ...props
}: TooltipProps) {
  const id = useId();
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const element = bubble.current;
    if (!element) return;

    if (!open) {
      if (POPOVER_SUPPORTED && element.matches(':popover-open')) element.hidePopover();
      return;
    }

    if (POPOVER_SUPPORTED && !element.matches(':popover-open')) element.showPopover();
    place(element, trigger, align, side);
  }, [open, trigger, align, side]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  function show() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }

  function hide() {
    if (timer.current !== null) clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        ref={setTrigger}
        aria-describedby={open ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Pressing it answers the question the tooltip was about to ask.
        onPointerDown={hide}
        onKeyDown={(event) => {
          if (event.key === 'Escape') hide();
        }}
        {...props}
      >
        {children}
      </button>

      <div
        ref={bubble}
        id={id}
        role="tooltip"
        {...(POPOVER_SUPPORTED ? { popover: 'manual' } : {})}
        hidden={POPOVER_SUPPORTED ? undefined : !open}
        className={cx(
          'bg-text-primary text-text-inverse pointer-events-none fixed m-0 max-w-56 rounded-md px-2 py-1 text-xs font-medium shadow-lg',
          POPOVER_SUPPORTED ? '' : 'z-50',
          'motion-safe:transition-[opacity,transform] motion-safe:duration-(--duration-instant)',
          open ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
        )}
      >
        {label}
      </div>
    </>
  );
}
