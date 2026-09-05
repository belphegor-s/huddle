import type { CallView } from './call';

/**
 * The line under a huddle, which is the only place a call explains itself.
 *
 * Pulled out of the stage because the case that matters is the one nobody
 * looks at: a connection that never comes up. Without a relay two browsers
 * that cannot reach each other never will, and saying "Connecting" for ever
 * leaves the person who has to fix it with nothing to go on.
 */
export function callStatus(
  call: Pick<CallView, 'status' | 'peers' | 'relay'>,
  tiles: number,
): string {
  if (call.status === 'joining') return 'Joining';

  const failed = call.peers.filter((peer) => peer.link === 'failed').length;

  if (failed > 0 && !call.relay) {
    return 'Could not reach everybody. This huddle has no relay set up, so it only works between people whose networks can see each other.';
  }

  if (failed > 0) {
    return failed === 1
      ? 'Could not reach one person. Their connection may have dropped.'
      : `Could not reach ${String(failed)} people. Their connections may have dropped.`;
  }

  return `${String(tiles)} ${tiles === 1 ? 'person' : 'people'}`;
}
