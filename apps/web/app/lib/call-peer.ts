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

/**
 * A connection that never reports a failure and never connects either is the
 * hard case: candidates were lost rather than rejected, so nothing fires. This
 * is how long to wait before assuming that happened.
 */
const STALLED_MS = 8_000;

/** Retries past this are not going to help, and the tile says so instead. */
const RESTART_ATTEMPTS = 3;

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
  /**
   * Which arriving stream is which, as the other end named them.
   *
   * Worked out rather than told, this went wrong the moment a share stopped:
   * stopping a track at the sender leaves the receiver's copy muted, not
   * ended, so the dead screen was still there to be mistaken for the camera,
   * and with it went the audio that was actually on the camera stream.
   */
  private cameraStreamId: string | null = null;
  private screenStreamId: string | null = null;
  /**
   * Descriptions and candidates have to be applied one at a time and in the
   * order they were sent. Two arriving while a `setRemoteDescription` is still
   * in flight would otherwise interleave and fail.
   */
  private work: Promise<void> = Promise.resolve();
  private makingOffer = false;
  private ignoringOffer = false;
  /**
   * A renegotiation that could not run when it was asked for.
   *
   * Turning a camera on adds a track, which asks for one, and the ask can land
   * while the opening offer is still in flight or while this end is not yet
   * allowed to make one. Dropping it there is how somebody ends up sending a
   * camera nobody receives until they rejoin, so it is remembered and run at
   * the next moment the connection is settled.
   */
  private pending = false;
  private closed = false;
  /** True once a description has been exchanged in either direction. */
  private negotiated = false;
  private stalled: ReturnType<typeof setTimeout> | null = null;
  private restarts = 0;

  constructor(private readonly options: PeerOptions) {
    this.connection = new RTCPeerConnection({ iceServers: options.iceServers });

    this.connection.onnegotiationneeded = () => {
      /*
       * Both ends add their tracks at the same moment, so both would offer and
       * every call would open with a collision for the politeness rule to
       * unpick. One end owns the first offer instead, and the answer to it
       * carries this end's tracks anyway, so there is nothing here to keep:
       * queueing it made the polite end offer again the instant it answered,
       * which is a renegotiation in the middle of connecting.
       *
       * After that first exchange either end may renegotiate, which is what
       * turning a camera on does, and one that cannot run yet is held rather
       * than dropped.
       */
      if (options.polite && !this.negotiated) return;

      this.pending = true;
      this.flush();
    };

    this.connection.onsignalingstatechange = () => {
      if (this.connection.signalingState === 'stable') this.flush();
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
      if (state === 'failed') this.restart();
      if (state === 'connected') this.clearWatchdog();
      else this.armWatchdog();

      options.onChange();
    };

    this.armWatchdog();
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
      this.cameraStreamId = signal.camera;
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
    this.negotiated = true;

    if (description.type !== 'offer') return;

    await this.connection.setLocalDescription();
    this.sendLocalDescription();

    // Answering settles the connection, which is the moment anything held back
    // gets to go out.
    this.flush();
  }

  close(): void {
    this.closed = true;
    this.clearWatchdog();
    this.connection.onnegotiationneeded = null;
    this.connection.onsignalingstatechange = null;
    this.connection.onicecandidate = null;
    this.connection.ontrack = null;
    this.connection.onconnectionstatechange = null;
    this.connection.close();
  }

  /**
   * A connection that never reports a failure and never connects is the hard
   * case, and it is the common one where there is no relay: the candidates
   * simply have nowhere to meet. Both ends watch for it, only one retries,
   * and when the retries are spent it is called what it is rather than left
   * saying "Connecting" for the rest of the call.
   */
  private armWatchdog(): void {
    if (this.closed || this.stalled !== null) return;

    this.stalled = setTimeout(() => {
      this.stalled = null;
      if (this.connection.connectionState === 'connected') return;

      if (this.restarts < RESTART_ATTEMPTS) {
        this.restarts += 1;
        // Both ends restarting at once is a collision the politeness rule then
        // has to unpick, which is slower than one of them owning the retry.
        if (!this.options.polite) this.restart();
        this.armWatchdog();
        return;
      }

      this.link = 'failed';
      this.options.onChange();
    }, STALLED_MS);
  }

  private clearWatchdog(): void {
    if (this.stalled !== null) clearTimeout(this.stalled);
    this.stalled = null;
    this.restarts = 0;
  }

  private restart(): void {
    if (this.closed) return;
    this.connection.restartIce();
  }

  /** Runs a held renegotiation, if this is a moment one can run in. */
  private flush(): void {
    if (!this.pending || this.closed) return;
    if (this.makingOffer || this.connection.signalingState !== 'stable') return;

    this.pending = false;
    void this.negotiate();
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;

    try {
      this.makingOffer = true;
      await this.connection.setLocalDescription();
      this.sendLocalDescription();
    } catch {
      // Held rather than dropped: whatever was added is still on the
      // connection and still has to be offered, so it goes out at the next
      // settled moment instead of never.
      this.pending = true;
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
      // A stream whose tracks have all ended is gone for good.
      if (stream.getTracks().every((track) => track.readyState === 'ended')) continue;

      if (id === this.screenStreamId) {
        screen = stream;
        continue;
      }

      if (id === this.cameraStreamId) {
        camera = stream;
        continue;
      }

      /*
       * Neither, which happens for the moment between a track arriving and
       * the message that names its stream. It is taken for the camera only
       * while no camera has been named, so a screen that has just stopped
       * being a screen cannot quietly take the camera's place.
       */
      if (this.cameraStreamId === null && id !== this.screenStreamId) camera ??= stream;
    }

    this.camera = camera;
    this.screen = screen;
  }
}
