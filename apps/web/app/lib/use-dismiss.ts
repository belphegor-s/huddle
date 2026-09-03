import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover on an outside click or on Escape.
 *
 * The outside listener is attached on the next tick, because the click that
 * opened the popover is still travelling up the document and would otherwise
 * close it again immediately.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    const timer = setTimeout(() => document.addEventListener('mousedown', onPointer), 0);
    document.addEventListener('keydown', onKey);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onClose]);
}
