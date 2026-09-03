import { useEffect, useState } from 'react';
import { currentPushState, disablePush, enablePush, type PushState } from '../lib/push';

const EXPLANATION: Partial<Record<PushState, string>> = {
  denied: 'Notifications are blocked for this site in your browser settings.',
  unsupported: 'This browser cannot deliver notifications.',
};

/**
 * Lives in the sidebar rather than on a settings screen, because on a phone
 * the sidebar is the home screen and a settings screen nobody reaches is a
 * feature nobody turns on.
 */
export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void currentPushState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to offer while the server has no VAPID pair configured.
  if (state === null || state === 'unavailable') return null;

  const on = state === 'on';
  const settled = state === 'on' || state === 'off';

  async function toggle() {
    setBusy(true);
    try {
      setState(await (on ? disablePush() : enablePush()));
    } catch {
      setState('off');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-1 pt-2">
      {settled ? (
        <button
          type="button"
          onClick={() => void toggle()}
          aria-pressed={on}
          disabled={busy}
          className="text-text-secondary hover:bg-surface-hover flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm disabled:opacity-55"
        >
          <span className="min-w-0 flex-1 truncate">Notifications</span>
          <span
            aria-hidden
            className={
              on
                ? 'bg-accent relative h-5 w-9 shrink-0 rounded-full transition-colors'
                : 'bg-border-strong relative h-5 w-9 shrink-0 rounded-full transition-colors'
            }
          >
            <span
              className={
                on
                  ? 'absolute top-0.5 left-4.5 size-4 rounded-full bg-white transition-[left] duration-(--duration-quick)'
                  : 'absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-[left] duration-(--duration-quick)'
              }
            />
          </span>
        </button>
      ) : (
        <p className="text-text-muted px-2 py-2 text-xs">{EXPLANATION[state]}</p>
      )}
    </div>
  );
}
