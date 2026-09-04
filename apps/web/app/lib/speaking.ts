/**
 * Who is talking, from the audio itself.
 *
 * A ring around the person currently speaking is the one thing that makes a
 * call of more than three people followable, and it cannot come from the
 * microphone button: somebody unmuted and silent is not speaking.
 */

/** Above this the room is hearing you. Below it you are breathing near a mic. */
const SPEAKING_THRESHOLD = 0.045;

/** Falling silent mid sentence is normal, so the ring lingers past a pause. */
const RELEASE_MS = 400;

const SAMPLE_MS = 100;

interface Watched {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  samples: Float32Array<ArrayBuffer>;
  loudUntil: number;
  speaking: boolean;
}

export class SpeakingMonitor {
  private context: AudioContext | null = null;
  private readonly watched = new Map<string, Watched>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onChange: (speaking: Set<string>) => void) {}

  watch(id: string, stream: MediaStream): void {
    if (this.watched.has(id)) return;
    if (stream.getAudioTracks().length === 0) return;

    // Created on the first stream rather than at construction, because a
    // context made before a gesture starts suspended and never recovers.
    this.context ??= new AudioContext();

    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;

    const source = this.context.createMediaStreamSource(stream);
    source.connect(analyser);

    this.watched.set(id, {
      analyser,
      source,
      samples: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
      loudUntil: 0,
      speaking: false,
    });

    this.timer ??= setInterval(() => this.sample(), SAMPLE_MS);
  }

  forget(id: string): void {
    const entry = this.watched.get(id);
    if (!entry) return;

    entry.source.disconnect();
    this.watched.delete(id);
  }

  close(): void {
    for (const id of [...this.watched.keys()]) this.forget(id);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    void this.context?.close();
    this.context = null;
  }

  private sample(): void {
    const now = Date.now();
    let changed = false;

    for (const entry of this.watched.values()) {
      entry.analyser.getFloatTimeDomainData(entry.samples);

      let sum = 0;
      for (const value of entry.samples) sum += value * value;
      const level = Math.sqrt(sum / entry.samples.length);

      if (level > SPEAKING_THRESHOLD) entry.loudUntil = now + RELEASE_MS;

      const speaking = entry.loudUntil > now;
      if (speaking !== entry.speaking) changed = true;
      entry.speaking = speaking;
    }

    if (!changed) return;

    const speaking = new Set<string>();
    for (const [id, entry] of this.watched) if (entry.speaking) speaking.add(id);
    this.onChange(speaking);
  }
}
