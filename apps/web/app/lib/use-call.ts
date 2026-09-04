import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { CallSession, CallView } from './call';
import type { Realtime } from './realtime';

export interface CallControls {
  call: CallView;
  join(channelId: string, options: { video: boolean; ref: string; name: string }): void;
  leave(): void;
  toggleMuted(): void;
  toggleVideo(): void;
  toggleSharing(): void;
}

/**
 * The call as React sees it. The session itself is plain and lives for as long
 * as the workspace does, so walking to another channel never drops the call.
 */
export function useCall(session: CallSession): CallControls {
  const call = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);

  return {
    call,
    join: useCallback(
      (channelId, options) => {
        void session.join(channelId, options);
      },
      [session],
    ),
    leave: useCallback(() => session.leave(), [session]),
    toggleMuted: useCallback(() => session.setMuted(!session.snapshot().muted), [session]),
    toggleVideo: useCallback(() => {
      void session.setVideo(!session.snapshot().video);
    }, [session]),
    toggleSharing: useCallback(() => {
      void session.setSharing(!session.snapshot().sharing);
    }, [session]),
  };
}

/**
 * How many are in this channel's call, kept live from the roster the server
 * broadcasts. It has to come from the socket rather than from the channel
 * list, because somebody reading a public channel they have not joined is not
 * a member and never receives the sidebar notice.
 */
export function useCallRoster(realtime: Realtime, channelId: string, initial: number): number {
  const [count, setCount] = useState(initial);

  useEffect(() => setCount(initial), [channelId, initial]);

  useEffect(() => {
    return realtime.on((event) => {
      if (event.type === 'call_roster' && event.channelId === channelId) {
        setCount(event.participants.length);
      }
    });
  }, [channelId, realtime]);

  return count;
}
