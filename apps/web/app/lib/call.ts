import { LIMITS, type CallParticipant, type ServerEvent } from '@huddle/core';
import { api } from './api';
import { CallPeer, type PeerLink, type Signal } from './call-peer';
import type { Realtime } from './realtime';
import { SpeakingMonitor } from './speaking';

/**
 * A call, as a mesh: every browser holds a connection to every other one and
 * the server only says who is present and passes descriptions between them.
 *
 * That is why the roster is capped. One copy of your camera goes to each of
 * the others, so the cost of the call grows with the room, and past a handful
 * of people a home connection stops keeping up. A larger room needs a server
 * that forwards streams, which is a second service, so it is deliberately not
 * here.
 */

export type CallStatus = 'idle' | 'joining' | 'live' | 'failed';

/** Enough for an offer and the candidates that follow it, and no more. */
const EARLY_SIGNALS_MAX = 64;

export interface PeerView {
  sessionId: string;
  userId: string;
  muted: boolean;
  video: boolean;
  sharing: boolean;
  speaking: boolean;
  link: PeerLink;
  camera: MediaStream | null;
  screen: MediaStream | null;
}

export interface CallView {
  channelId: string | null;
  status: CallStatus;
  /** Shown to the caller, so it is a sentence rather than a code. */
  error: string | null;
  muted: boolean;
  video: boolean;
  sharing: boolean;
  speaking: boolean;
  camera: MediaStream | null;
  screen: MediaStream | null;
  peers: PeerView[];
}

const IDLE: CallView = {
  channelId: null,
  status: 'idle',
  error: null,
  muted: false,
  video: false,
  sharing: false,
  speaking: false,
  camera: null,
  screen: null,
  peers: [],
};

export class CallSession {
  private view: CallView = IDLE;
  private readonly listeners = new Set<() => void>();
  private readonly peers = new Map<string, CallPeer>();
  /**
   * An offer can arrive before the roster that says who sent it, because the
   * two travel independently. Dropping it deadlocks the connection: the other
   * end has already offered and will not offer again. So it waits here until
   * the roster catches up.
   */
  private readonly early = new Map<string, string[]>();
  private roster: CallParticipant[] = [];
  private speakingIds = new Set<string>();
  private iceServers: RTCIceServer[] = [];
  private local: MediaStream | null = null;
  private display: MediaStream | null = null;
  private monitor: SpeakingMonitor | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly realtime: Realtime) {
    realtime.on((event) => this.accept(event));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): CallView => this.view;

  async join(channelId: string, options: { video: boolean }): Promise<void> {
    if (this.view.channelId !== null) this.leave();
    this.update({ ...IDLE, channelId, status: 'joining', video: options.video });

    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: options.video ? { width: 1280, height: 720 } : false,
      });
    } catch {
      this.update({
        ...this.view,
        status: 'failed',
        error: 'huddle could not reach your microphone. Check the site permissions and try again.',
      });
      return;
    }

    // Fetched per call rather than at page load: a minted relay credential
    // expires, so one taken at sign in would already be stale.
    this.iceServers = await api.iceServers().catch(() => []);

    this.monitor = new SpeakingMonitor((speaking) => {
      this.speakingIds = speaking;
      this.refresh();
    });
    this.monitor.watch('self', this.local);

    this.realtime.send({ type: 'call_join', channelId, video: options.video });
    this.heartbeat = setInterval(
      () => this.realtime.send({ type: 'call_heartbeat', channelId }),
      LIMITS.callHeartbeatMs,
    );

    this.update({ ...this.view, status: 'live', camera: this.local });
  }

  leave(): void {
    const channelId = this.view.channelId;
    if (channelId !== null) this.realtime.send({ type: 'call_leave', channelId });

    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();

    for (const track of this.local?.getTracks() ?? []) track.stop();
    for (const track of this.display?.getTracks() ?? []) track.stop();
    this.local = null;
    this.display = null;

    this.monitor?.close();
    this.monitor = null;

    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;

    this.roster = [];
    this.early.clear();
    this.speakingIds = new Set();
    this.update(IDLE);
  }

  /**
   * Muting is the track going silent rather than the connection changing, so
   * it takes effect immediately and cannot fail halfway.
   */
  setMuted(muted: boolean): void {
    for (const track of this.local?.getAudioTracks() ?? []) track.enabled = !muted;
    this.update({ ...this.view, muted });
    this.publishState();
  }

  async setVideo(on: boolean): Promise<void> {
    const existing = this.local?.getVideoTracks() ?? [];

    if (!on) {
      for (const track of existing) track.enabled = false;
      this.update({ ...this.view, video: false });
      this.publishState();
      return;
    }

    if (existing.length > 0) {
      for (const track of existing) track.enabled = true;
    } else {
      // Joining without a camera means never asking for one, so the first time
      // it is turned on the track has to be acquired and offered around.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
      });
      const track = stream.getVideoTracks()[0];
      if (!track || !this.local) return;

      this.local.addTrack(track);
      for (const peer of this.peers.values()) peer.connection.addTrack(track, this.local);
    }

    this.update({ ...this.view, video: true, camera: this.local });
    this.publishState();
  }

  async setSharing(on: boolean): Promise<void> {
    if (!on) {
      for (const track of this.display?.getTracks() ?? []) track.stop();
      this.display = null;
      this.update({ ...this.view, sharing: false, screen: null });
      this.describeStreams();
      this.publishState();
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      // Dismissing the picker is a decision, not an error worth reporting.
      return;
    }

    this.display = stream;
    for (const peer of this.peers.values()) {
      for (const track of stream.getTracks()) peer.connection.addTrack(track, stream);
    }

    // Stopping from the browser's own bar is the usual way out of a share,
    // and it never goes through our button.
    const [track] = stream.getVideoTracks();
    if (track) track.onended = () => void this.setSharing(false);

    this.update({ ...this.view, sharing: true, screen: stream });
    this.describeStreams();
    this.publishState();
  }

  private accept(event: ServerEvent): void {
    if (event.type === 'call_roster') {
      if (event.channelId !== this.view.channelId) return;
      this.roster = event.participants;
      this.reconcile();
      return;
    }

    if (event.type === 'call_signal') {
      if (event.channelId !== this.view.channelId) return;
      if (event.to !== this.realtime.sessionId) return;
      this.route(event.from, event.data);
      return;
    }

    if (event.type === 'error' && this.view.status === 'joining') {
      const message =
        event.message === 'call_full'
          ? `This call is full. A huddle holds ${String(LIMITS.callParticipantsMax)} people.`
          : 'huddle could not join this call.';

      this.leave();
      this.update({ ...IDLE, status: 'failed', error: message });
    }
  }

  private route(from: string, data: string): void {
    const peer = this.peers.get(from);

    if (!peer) {
      const waiting = this.early.get(from) ?? [];
      // Bounded, so a sender that never appears on the roster cannot grow it.
      if (waiting.length < EARLY_SIGNALS_MAX) waiting.push(data);
      this.early.set(from, waiting);
      return;
    }

    // Peers apply signals in order internally, so this does not need awaiting.
    // A description that cannot be applied leaves the connection where it was.
    void peer.accept(JSON.parse(data) as Signal);
  }

  /** Brings the set of connections into line with the roster the server sent. */
  private reconcile(): void {
    const mine = this.realtime.sessionId;
    const present = new Set(this.roster.map((participant) => participant.sessionId));

    for (const [sessionId, peer] of this.peers) {
      if (present.has(sessionId)) continue;
      peer.close();
      this.peers.delete(sessionId);
      this.monitor?.forget(sessionId);
    }

    for (const sessionId of this.early.keys()) {
      if (!present.has(sessionId)) this.early.delete(sessionId);
    }

    for (const participant of this.roster) {
      if (participant.sessionId === mine) continue;
      if (this.peers.has(participant.sessionId)) continue;
      this.connectTo(participant.sessionId, mine);
    }

    this.refresh();
  }

  private connectTo(sessionId: string, mine: string): void {
    const channelId = this.view.channelId;
    if (channelId === null) return;

    const peer = new CallPeer({
      // Whoever holds the lower id yields when both offer at once. Session ids
      // are unique, so both ends reach the same answer without asking.
      polite: mine < sessionId,
      iceServers: this.iceServers,
      send: (signal) => {
        this.realtime.send({
          type: 'call_signal',
          channelId,
          to: sessionId,
          data: JSON.stringify(signal),
        });
      },
      onChange: () => {
        if (peer.camera) this.monitor?.watch(sessionId, peer.camera);
        this.refresh();
      },
    });

    this.peers.set(sessionId, peer);

    if (this.local) {
      for (const track of this.local.getTracks()) peer.connection.addTrack(track, this.local);
    }
    if (this.display) {
      for (const track of this.display.getTracks()) peer.connection.addTrack(track, this.display);
    }

    peer.describeStreams(this.local, this.display);

    const waiting = this.early.get(sessionId) ?? [];
    this.early.delete(sessionId);
    for (const data of waiting) void peer.accept(JSON.parse(data) as Signal);
  }

  private describeStreams(): void {
    for (const peer of this.peers.values()) peer.describeStreams(this.local, this.display);
  }

  private publishState(): void {
    const channelId = this.view.channelId;
    if (channelId === null) return;

    this.realtime.send({
      type: 'call_update',
      channelId,
      muted: this.view.muted,
      video: this.view.video,
      sharing: this.view.sharing,
    });
  }

  private refresh(): void {
    const mine = this.realtime.sessionId;

    const peers = this.roster
      .filter((participant) => participant.sessionId !== mine)
      .map((participant) => {
        const peer = this.peers.get(participant.sessionId);

        return {
          sessionId: participant.sessionId,
          userId: participant.userId,
          muted: participant.muted,
          video: participant.video,
          sharing: participant.sharing,
          speaking: !participant.muted && this.speakingIds.has(participant.sessionId),
          link: peer?.link ?? 'connecting',
          camera: peer?.camera ?? null,
          screen: peer?.screen ?? null,
        } satisfies PeerView;
      });

    this.update({
      ...this.view,
      peers,
      speaking: !this.view.muted && this.speakingIds.has('self'),
    });
  }

  private update(view: CallView): void {
    this.view = view;
    for (const listener of this.listeners) listener();
  }
}
