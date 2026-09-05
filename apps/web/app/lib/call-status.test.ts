import { describe, expect, it } from 'vitest';
import { callStatus } from './call-status';
import type { PeerView } from './call';

function peer(link: PeerView['link']): PeerView {
  return {
    sessionId: link,
    userId: 'u',
    muted: false,
    video: false,
    sharing: false,
    speaking: false,
    link,
    camera: null,
    screen: null,
  };
}

describe('callStatus', () => {
  it('says so while it is still joining', () => {
    expect(callStatus({ status: 'joining', peers: [], relay: false }, 1)).toBe('Joining');
  });

  it('counts the room when everybody is through', () => {
    expect(callStatus({ status: 'live', peers: [peer('connected')], relay: false }, 2)).toBe(
      '2 people',
    );
    expect(callStatus({ status: 'live', peers: [], relay: false }, 1)).toBe('1 person');
  });

  it('says nothing new while a connection is still trying', () => {
    expect(callStatus({ status: 'live', peers: [peer('connecting')], relay: false }, 2)).toBe(
      '2 people',
    );
  });

  it('names the deployment gap when nothing can be reached and there is no relay', () => {
    // The one people actually hit: two networks that cannot see each other,
    // and a call that used to say "Connecting" until somebody gave up.
    const said = callStatus({ status: 'live', peers: [peer('failed')], relay: false }, 2);

    expect(said).toContain('no relay');
  });

  it('blames the connection rather than the deployment when there is a relay', () => {
    const said = callStatus({ status: 'live', peers: [peer('failed')], relay: true }, 2);

    expect(said).toContain('one person');
    expect(said).not.toContain('relay');
  });

  it('counts how many could not be reached', () => {
    const said = callStatus(
      {
        status: 'live',
        peers: [peer('failed'), { ...peer('failed'), sessionId: 'b' }],
        relay: true,
      },
      3,
    );

    expect(said).toContain('2 people');
  });
});
