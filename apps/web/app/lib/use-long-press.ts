import { useCallback, useRef } from 'react';

/** Long enough not to fire while scrolling, short enough to feel deliberate. */
const HOLD_MS = 450;

/** A drag past this is a scroll, not a press. */
const SLOP_PX = 10;

export interface LongPressHandlers {
  onPointerDown(event: React.PointerEvent): void;
  onPointerMove(event: React.PointerEvent): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onContextMenu(event: React.MouseEvent): void;
}

/**
 * Hold to act, which is how every message on a phone is reached.
 *
 * Only for touch and pen: a mouse has hover, and firing this on a slow click
 * would fight the click itself. The context menu is suppressed for the same
 * gesture, because a long press on mobile Safari and Chrome would otherwise
 * open the browser's own menu on top of ours.
 */
export function useLongPress(onTrigger: () => void): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const touch = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  return {
    onPointerDown(event) {
      touch.current = event.pointerType !== 'mouse';
      if (!touch.current) return;

      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        cancel();
        onTrigger();
      }, HOLD_MS);
    },

    onPointerMove(event) {
      const start = origin.current;
      if (start === null) return;

      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved > SLOP_PX) cancel();
    },

    onPointerUp: cancel,
    onPointerCancel: cancel,

    onContextMenu(event) {
      if (touch.current) event.preventDefault();
    },
  };
}
