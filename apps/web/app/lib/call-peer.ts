/**
 * One leg of a mesh call: the connection between this browser and one other.
 *
 * Negotiation follows the perfect negotiation pattern, which is the answer to
 * both ends deciding to renegotiate at the same moment. Somebody starting to
 * share a screen while somebody else turns their camera on is exactly that
 * collision, and without a rule for who yields it deadlocks the connection.
 */

export type Signal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
  /** Which of the streams arriving on this connection is the screen. */
  | { kind: 'streams'; camera: string | null; screen: string | null };

export type PeerLink = 'connecting' | 'connected' | 'failed';

interface PeerOptions {
  /** Lower session id yields on a collision. Deterministic on both ends. */
  polite: boolean;
  iceServers: RTCIceServer[];
  send(signal: Signal): void;
  onChange(): void;
}

export class CallPeer {
  readonly connection: RTCPeerConnection;
  camera: MediaStream | null = null;
  screen: MediaStream | null = null;
  link: PeerLink = 'connecting';

  private readonly streams = new Map<string, MediaStream>();
  private screenStreamId: string | null = null;
  /**
   * Descriptions and candidates have to be applied one at a time and in the
   * order they were sent. Two arriving while a `setRemoteDescription` is still
   * in flight would otherwise interleave and fail.
   */
  private work: Promise<void> = Promise.resolve();
  private makingOffer = false;
  private ignoringOffer = false;
  private closed = false;

  constructor(private readonly options: PeerOptions) {
    this.connection = new RTCPeerConnection({ iceServers: options.iceServers });

    this.connection.onnegotiationneeded = () => {
      void this.negotiate();
    };

    this.connection.onicecandidate = ({ candidate }) => {
      if (candidate) options.send({ kind: 'candidate', candidate: candidate.toJSON() });
    };

    this.connection.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      this.streams.set(stream.id, stream);
      // A track can arrive before the message saying which stream is which,
      // so the split is recomputed rather than decided once.
      this.sortStreams();

      // Ending a screen share removes the track rather than the stream, so the
      // tile has to be told again once the stream is empty.
      event.track.onended = () => this.sortStreams();
      options.onChange();
    };

    this.connection.onconnectionstatechange = () => {
      const state = this.connection.connectionState;

      if (state === 'connected') this.link = 'connected';
      else if (state === 'failed') this.link = 'failed';
      else if (state === 'disconnected' || state === 'connecting') this.link = 'connecting';

      // A path that dies mid call usually comes back, and restarting ICE is
      // cheaper and far less visible than tearing the call down.
      if (state === 'failed' && !this.closed) this.connection.restartIce();

      options.onChange();
    };
  }

  /** Announced explicitly rather than guessed from track order. */
  describeStreams(camera: MediaStream | null, screen: MediaStream | null): void {
    this.options.send({
      kind: 'streams',
      camera: camera?.id ?? null,
      screen: screen?.id ?? null,
    });
  }

  accept(signal: Signal): Promise<void> {
    this.work = this.work.then(() => this.apply(signal)).catch(() => undefined);
    return this.work;
  }

  private async apply(signal: Signal): Promise<void> {
    if (this.closed) return;

    if (signal.kind === 'streams') {
      this.screenStreamId = signal.screen;
      this.sortStreams();
      this.options.onChange();
      return;
    }

    if (signal.kind === 'candidate') {
      try {
        await this.connection.addIceCandidate(signal.candidate);
      } catch (error) {
        // Candidates for an offer that was deliberately dropped arrive anyway
        // and have nowhere to go. Any other failure is real.
        if (!this.ignoringOffer) throw error;
      }
      return;
    }

    const description = { type: signal.kind, sdp: signal.sdp } as const;
    const collision =
      description.type === 'offer' &&
      (this.makingOffer || this.connection.signalingState !== 'stable');

    this.ignoringOffer = !this.options.polite && collision;
    if (this.ignoringOffer) return;

    await this.connection.setRemoteDescription(description);
    if (description.type !== 'offer') return;

    await this.connection.setLocalDescription();
    this.sendLocalDescription();
  }

  close(): void {
    this.closed = true;
    this.connection.onnegotiationneeded = null;
    this.connection.onicecandidate = null;
    this.connection.ontrack = null;
    this.connection.onconnectionstatechange = null;
    this.connection.close();
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;

    try {
      this.makingOffer = true;
      await this.connection.setLocalDescription();
      this.sendLocalDescription();
    } catch {
      // A failed offer leaves the connection where it was. The state change
      // handler restarts ICE if the connection itself is the problem.
    } finally {
      this.makingOffer = false;
    }
  }

  private sendLocalDescription(): void {
    const local = this.connection.localDescription;
    if (!local || (local.type !== 'offer' && local.type !== 'answer')) return;

    this.options.send({ kind: local.type, sdp: local.sdp });
  }

  private sortStreams(): void {
    let camera: MediaStream | null = null;
    let screen: MediaStream | null = null;

    for (const [id, stream] of this.streams) {
      // A stream whose tracks have all ended is a share that was stopped.
      if (stream.getTracks().every((track) => track.readyState === 'ended')) continue;
      if (id === this.screenStreamId) screen = stream;
      else camera = stream;
    }

    this.camera = camera;
    this.screen = screen;
  }
}
