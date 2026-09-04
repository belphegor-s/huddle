import { LIMITS, resampleWaveform } from '@huddle/core';

export interface Recording {
  file: File;
  durationMs: number;
  peaks: number[];
}

/**
 * Records a voice note and computes its waveform while recording, not after.
 *
 * The peaks are sampled from the live analyser, so a five minute note costs
 * nothing to summarise and playback never has to decode the file to draw
 * anything.
 */
/** Often enough that a short note still has a shape worth drawing. */
const SAMPLE_MS = 50;

/** The longest note this app allows, at that rate, with room to spare. */
const MAX_SAMPLES = Math.ceil(LIMITS.voiceNoteMs / SAMPLE_MS) + 8;

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private readonly chunks: Blob[] = [];
  private readonly peaks: number[] = [];
  private startedAt = 0;
  private sampler: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recorder = new MediaRecorder(this.stream, { mimeType: pickMimeType() });
    this.startedAt = Date.now();

    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });

    this.context = new AudioContext();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    this.context.createMediaStreamSource(this.stream).connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    // Sampled at a fixed rate and reduced to the drawing's width when the
    // recording stops. Spacing the samples out to fill the waveform over the
    // maximum length instead gave a three second note a single bar.
    this.sampler = setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      if (this.peaks.length < MAX_SAMPLES) this.peaks.push(peak);
    }, SAMPLE_MS);

    this.recorder.start(250);
  }

  async stop(): Promise<Recording | null> {
    const recorder = this.recorder;
    if (!recorder) return null;

    const finished = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });

    recorder.stop();
    await finished;
    this.teardown();

    if (this.chunks.length === 0) return null;

    const type = recorder.mimeType || 'audio/webm';
    const blob = new Blob(this.chunks, { type });

    return {
      file: new File([blob], `voice-${Date.now()}.${extensionFor(type)}`, { type }),
      durationMs: Date.now() - this.startedAt,
      peaks: resampleWaveform(this.peaks, LIMITS.waveformPeaks),
    };
  }

  cancel(): void {
    this.recorder?.stop();
    this.teardown();
    this.chunks.length = 0;
  }

  private teardown(): void {
    if (this.sampler !== null) clearInterval(this.sampler);
    this.sampler = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    void this.context?.close();
    this.stream = null;
    this.context = null;
  }
}

/** Safari has no Opus in WebM, so the container is negotiated rather than assumed. */
function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function extensionFor(mimeType: string): string {
  return mimeType.includes('mp4') ? 'm4a' : 'webm';
}
