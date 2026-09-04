import { cx, Icon } from '@huddle/ui';
import { Link, useParams } from 'react-router';
import type { CallSession } from '../lib/call';
import { useCall } from '../lib/use-call';

interface CallDockProps {
  call: CallSession;
  workspaceSlug: string;
}

/**
 * Proof that you are still in a call you have walked away from.
 *
 * Leaving a huddle open in one channel and going to read another is normal,
 * and the failure it prevents is the one everybody has had: talking for a
 * minute into a call you thought you had left.
 */
export function CallDock({ call: session, workspaceSlug }: CallDockProps) {
  const { call, leave, toggleMuted } = useCall(session);
  const params = useParams();

  // Silent while you are looking at the call itself, which shows all of this.
  if (call.channelId === null || call.status !== 'live') return null;
  if (params.ref === call.channelRef) return null;

  return (
    <div className="bg-accent text-on-accent flex items-center gap-2 px-3 py-1.5 text-xs">
      <span
        className={cx('size-2 shrink-0 rounded-full bg-current', call.speaking && 'animate-pulse')}
      />

      <Link
        to={`/w/${workspaceSlug}/c/${call.channelRef}`}
        className="min-w-0 flex-1 truncate text-current"
      >
        In a huddle in {call.channelName}
      </Link>

      <button
        type="button"
        onClick={toggleMuted}
        aria-label={call.muted ? 'Unmute' : 'Mute'}
        aria-pressed={call.muted}
        className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-black/10"
      >
        <Icon name={call.muted ? 'micOff' : 'mic'} className="size-4" />
      </button>

      <button
        type="button"
        onClick={leave}
        className="min-h-8 shrink-0 rounded-full bg-black/15 px-3 font-medium hover:bg-black/25"
      >
        Leave
      </button>
    </div>
  );
}
