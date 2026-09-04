/**
 * Turns however many amplitude samples were taken into the fixed number of
 * bars a waveform draws.
 *
 * Sampling has to run fast, because a voice note is usually a few seconds and
 * sampling at the rate a five minute note would need leaves a three second
 * note with one bar. So the recorder samples often and this reduces what it
 * collected to the width of the drawing.
 *
 * Two choices decide whether the result looks like a voice or like a fence.
 *
 * Each bar is the energy across its window rather than the loudest instant in
 * it. Taking the loudest catches a peak in almost every window once a window
 * covers half a second, so every bar reaches the top and the shape says
 * nothing beyond talking or not talking.
 *
 * Full height is the ninetieth percentile rather than the loudest bar. Speech
 * has a high crest factor: one plosive can be three times the rest, and
 * dividing by it presses the whole recording into the bottom third. The few
 * bars above the percentile clip, which costs nothing, because nobody reads a
 * waveform to find out exactly how loud the loudest syllable was.
 */

/** Below this the recording is silence, and amplifying it only draws hiss. */
const SILENCE = 0.02;

/**
 * A quiet voice should still look like a voice, but a whisper must not be
 * stretched to full height or every note looks identically loud.
 */
const MAX_GAIN = 8;

/** What counts as the top of the drawing. The rest clips. */
const FULL_HEIGHT_PERCENTILE = 0.9;

export function resampleWaveform(samples: readonly number[], buckets: number): number[] {
  if (buckets <= 0 || samples.length === 0) return [];

  const energy: number[] = [];

  for (let index = 0; index < buckets; index++) {
    const from = Math.floor((index * samples.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((index + 1) * samples.length) / buckets));

    let sum = 0;
    let count = 0;
    for (let at = from; at < to && at < samples.length; at++) {
      const value = samples[at] ?? 0;
      sum += value * value;
      count += 1;
    }

    energy.push(count === 0 ? 0 : Math.sqrt(sum / count));
  }

  const loudest = Math.max(...energy);
  if (loudest < SILENCE) return energy.map(() => 0);

  const reference = percentile(energy, FULL_HEIGHT_PERCENTILE) || loudest;
  const gain = Math.min(MAX_GAIN, 1 / reference);

  return energy.map((value) => Number(Math.min(1, value * gain).toFixed(3)));
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(fraction * (sorted.length - 1))] ?? 0;
}
