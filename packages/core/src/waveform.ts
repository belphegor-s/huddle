/**
 * Turns however many amplitude samples were taken into the fixed number of
 * bars a waveform draws.
 *
 * Sampling has to run fast, because a voice note is usually a few seconds and
 * sampling at the rate a five minute note would need leaves a three second
 * note with one bar. So the recorder samples often and this reduces what it
 * collected to the width of the drawing.
 */

/** Below this the recording is silence, and amplifying it only draws hiss. */
const SILENCE = 0.02;

/**
 * A quiet voice should still look like a voice, but a whisper must not be
 * stretched to full height or every note looks identically loud.
 */
const MAX_GAIN = 6;

export function resampleWaveform(samples: readonly number[], buckets: number): number[] {
  if (buckets <= 0 || samples.length === 0) return [];

  const out: number[] = [];

  for (let index = 0; index < buckets; index++) {
    const from = Math.floor((index * samples.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((index + 1) * samples.length) / buckets));

    // The loudest moment in the window, not the average. Speech is mostly gaps,
    // and averaging flattens it into a straight line.
    let peak = 0;
    for (let at = from; at < to && at < samples.length; at++) {
      peak = Math.max(peak, samples[at] ?? 0);
    }
    out.push(peak);
  }

  const loudest = Math.max(...out);
  if (loudest < SILENCE) return out.map(() => 0);

  const gain = Math.min(MAX_GAIN, 1 / loudest);
  return out.map((value) => Number(Math.min(1, value * gain).toFixed(3)));
}
