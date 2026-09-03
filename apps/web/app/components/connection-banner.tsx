import { useEffect, useState } from 'react';
import type { Realtime } from '../lib/realtime';

/**
 * Only appears once a reconnect has been failing for a moment.
 *
 * A socket blips constantly on a phone and reconnects in milliseconds, so
 * showing every drop would train people to ignore the one that matters. The
 * delay means this only speaks when something is actually wrong, and it says
 * what is still true: nothing is lost, because the client replays from the
 * sequence it holds once the socket comes back.
 */
const GRACE_MS = 3000;

export function ConnectionBanner({ realtime }: { realtime: Realtime }) {
  const [struggling, setStruggling] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = realtime.onStatus((status) => {
      if (timer !== null) clearTimeout(timer);

      if (status === 'open') {
        setStruggling(false);
        return;
      }

      timer = setTimeout(() => setStruggling(true), GRACE_MS);
    });

    return () => {
      if (timer !== null) clearTimeout(timer);
      stop();
    };
  }, [realtime]);

  if (!struggling) return null;

  return (
    <p
      role="status"
      className="bg-caution/15 text-caution border-caution/30 flex items-center justify-center gap-2 border-b px-3 py-1.5 text-xs"
    >
      <span aria-hidden className="bg-caution size-1.5 animate-pulse rounded-full" />
      Reconnecting. Nothing you have sent is lost.
    </p>
  );
}
