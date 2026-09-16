import { useEffect, useState, type ReactNode } from 'react';

/** Kept in step with --duration-exit in tokens.css. */
export const EXIT_MS = 140;

export interface PresenceProps {
  open: boolean;
  /** How long the caller's own leave transition runs. */
  exitMs?: number;
  /** The panel to keep alive, handed whether it is currently showing. */
  children(shown: boolean): ReactNode;
}

/**
 * Keeps a panel mounted through its exit.
 *
 * A panel that is removed the instant its state flips has nothing left to
 * animate: it simply blinks out. This holds it in the tree for the length of
 * the leave and drops it after, so an open and a close both get a frame to
 * play. The flag handed to the children is what their transition classes key
 * off, and it turns false on the frame the panel is told to go.
 */
export function Presence({ open, exitMs = EXIT_MS, children }: PresenceProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }

    setShown(false);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(false);
      return;
    }

    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  if (!mounted) return null;
  return <>{children(shown)}</>;
}
