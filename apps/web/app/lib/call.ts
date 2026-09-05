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

export interface Devices {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  /** What is in use, which is not always what was asked for. */
  microphoneId: string | null;
  cameraId: string | null;
}

/** What the connection is actually doing, read from the peer statistics. */
export interface CallStats {
  /** Round trip to the other end, in milliseconds. */
  latencyMs: number | null;
  /** Share of packets that never arrived, as a percentage. */
  lossPercent: number | null;
  /** Incoming, in kilobits per second. */
  inboundKbps: number | null;
}

export interface CallView {
  channelId: string | null;
  /**
   * How the channel appears in a URL, and what to call it. Carried on the call
   * rather than looked up, because somebody reading a public channel they have
   * not joined does not have it in their channel list at all.
   */
  channelRef: string;
  channelName: string;
  status: CallStatus;
  /** Shown to the caller, so it is a sentence rather than a code. */
  error: string | null;
  muted: boolean;
  video: boolean;
  sharing: boolean;
  speaking: boolean;
  camera: MediaStream | null;
  screen: MediaStream | null;
  devices: Devices;
  peers: PeerView[];
}

const NO_DEVICES: Devices = {
  microphones: [],
  cameras: [],
  microphoneId: null,
  cameraId: null,
};

const IDLE: CallView = {
  channelId: null,
  channelRef: '',
  channelName: '',
  status: 'idle',
  error: null,
  muted: false,
  video: false,
  sharing: false,
  speaking: false,
  camera: null,
  devices: NO_DEVICES,
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
  private chosen: { microphoneId?: string; cameraId?: string } = {};

  constructor(private readonly realtime: Realtime) {
    realtime.on((event) => this.accept(event));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): CallView => this.view;

  async join(
    channelId: string,
    options: { video: boolean; ref: string; name: string },
  ): Promise<void> {
    if (this.view.channelId !== null) this.leave();
    this.update({
      ...IDLE,
      channelId,
      channelRef: options.ref,
      channelName: options.name,
      status: 'joining',
      video: options.video,
    });

    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(this.chosen.microphoneId ? { deviceId: { exact: this.chosen.microphoneId } } : {}),
        },
        video: options.video
          ? {
              width: 1280,
              height: 720,
              ...(this.chosen.cameraId ? { deviceId: { exact: this.chosen.cameraId } } : {}),
            }
          : false,
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
    await this.readDevices();
  }

  /**
   * The microphones and cameras this browser will admit to.
   *
   * Labels are blank until permission has been granted, which is why this runs
   * after the stream is open rather than before: a list of "Microphone 1,
   * Microphone 2" is no use to anybody choosing between them.
   */
  async readDevices(): Promise<void> {
    if (!navigator.mediaDevices.enumerateDevices) return;

    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const settings = {
      microphoneId: this.local?.getAudioTracks()[0]?.getSettings().deviceId ?? null,
      cameraId: this.local?.getVideoTracks()[0]?.getSettings().deviceId ?? null,
    };

    this.update({
      ...this.view,
      devices: {
        microphones: all.filter((device) => device.kind === 'audioinput'),
        cameras: all.filter((device) => device.kind === 'videoinput'),
        ...settings,
      },
    });
  }

  /**
   * Swaps one input for another without renegotiating.
   *
   * `replaceTrack` changes what a sender is sending in place, so the other end
   * sees a new picture and never knows anything happened. Removing and adding
   * a track would tear the connection down and build it again in front of
   * everybody.
   */
  async useDevice(kind: 'audio' | 'video', deviceId: string): Promise<void> {
    if (!this.local) return;

    if (kind === 'audio') this.chosen.microphoneId = deviceId;
    else this.chosen.cameraId = deviceId;

    const replacement = await navigator.mediaDevices
      .getUserMedia(
        kind === 'audio'
          ? { audio: { deviceId: { exact: deviceId }, echoCancellation: true } }
          : { video: { deviceId: { exact: deviceId }, width: 1280, height: 720 } },
      )
      .catch(() => null);

    const track = replacement?.getTracks()[0];
    if (!track) return;

    const previous = kind === 'audio' ? this.local.getAudioTracks() : this.local.getVideoTracks();
    for (const old of previous) {
      this.local.removeTrack(old);
      old.stop();
    }

    track.enabled = kind === 'audio' ? !this.view.muted : this.view.video;
    this.local.addTrack(track);

    for (const peer of this.peers.values()) {
      const sender = peer.connection.getSenders().find((one) => one.track?.kind === kind);
      if (sender) await sender.replaceTrack(track);
    }

    if (kind === 'audio') {
      this.monitor?.forget('self');
      this.monitor?.watch('self', this.local);
    }

    this.update({ ...this.view, camera: this.local });
    await this.readDevices();
  }

  /**
   * What the connection is doing, from the browser's own statistics.
   *
   * Read on demand rather than polled: nobody needs this until they open the
   * panel, and gathering it on every call for everybody would cost more than
   * it tells anyone.
   */
  async readStats(): Promise<CallStats> {
    const first = [...this.peers.values()][0];
    if (!first) return { latencyMs: null, lossPercent: null, inboundKbps: null };

    const report = await first.connection.getStats();
    let latencyMs: number | null = null;
    let lossPercent: number | null = null;
    let inboundKbps: number | null = null;

    report.forEach((entry) => {
      if (entry.type === 'candidate-pair' && entry.state === 'succeeded') {
        const trip = (entry as { currentRoundTripTime?: number }).currentRoundTripTime;
        if (typeof trip === 'number') latencyMs = Math.round(trip * 1000);
      }

      if (entry.type === 'inbound-rtp' && entry.kind === 'audio') {
        const stat = entry as {
          packetsLost?: number;
          packetsReceived?: number;
          bytesReceived?: number;
        };
        const received = stat.packetsReceived ?? 0;
        const lost = stat.packetsLost ?? 0;

        if (received + lost > 0) lossPercent = Math.round((lost / (received + lost)) * 1000) / 10;
        if (typeof stat.bytesReceived === 'number') {
          inboundKbps = Math.round((stat.bytesReceived * 8) / 1000);
        }
      }
    });

    return { latencyMs, lossPercent, inboundKbps };
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
