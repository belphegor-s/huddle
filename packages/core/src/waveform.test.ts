import { describe, expect, it } from 'vitest';
import { resampleWaveform } from './waveform.js';

/** How much the bars differ from one another, which is what makes a shape. */
function variation(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squares / values.length);
}

/** Speech: phrases with gaps, syllables inside them, and occasional plosives. */
function speech(length: number): number[] {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  return Array.from({ length }, (_, index) => {
    const talking = Math.sin(index / 55) > -0.25;
    if (!talking) return 0.005 + random() * 0.01;

    const syllable = Math.abs(Math.sin(index / 2.6)) ** 1.5;
    const plosive = random() > 0.985 ? 3.2 : 1;
    const passage = 0.75 + 0.45 * Math.sin(index / 31);
    return Math.min(1, (0.05 + 0.22 * syllable) * plosive * passage);
  });
}

describe('resampleWaveform', () => {
  it('gives a short recording a full waveform rather than one bar', () => {
    // What a three second note used to produce: a handful of samples for a
    // drawing that wants a hundred and twenty eight bars.
    const drawn = resampleWaveform([0.4, 0.9, 0.2, 0.7], 128);

    expect(drawn).toHaveLength(128);
    expect(drawn.every((value) => value > 0)).toBe(true);
  });

  it('reduces a long recording to the width of the drawing', () => {
    expect(resampleWaveform(speech(6000), 128)).toHaveLength(128);
  });

  it('draws a shape rather than a fence', () => {
    // The old rule, the loudest instant in each window over the loudest bar,
    // measured about 0.2 here: one plosive pressed every other bar to a third
    // of the height and the result read as a flat line with two spikes.
    const drawn = resampleWaveform(speech(600), 48);
    expect(variation(drawn)).toBeGreaterThan(0.3);
  });

  it('does not let one loud syllable flatten the rest', () => {
    const withPlosive = [...Array.from({ length: 40 }, () => 0.2), 1, 1];
    const drawn = resampleWaveform(withPlosive, 16);

    // The ordinary speech has to stay near the top, not sink under the peak.
    const ordinary = drawn.slice(0, 12);
    expect(Math.min(...ordinary)).toBeGreaterThan(0.7);
  });

  it('keeps the quiet parts quiet', () => {
    const loudThenSoft = [
      ...Array.from({ length: 30 }, () => 0.6),
      ...Array.from({ length: 30 }, () => 0.05),
    ];
    const drawn = resampleWaveform(loudThenSoft, 20);

    expect(Math.max(...drawn.slice(0, 8))).toBeGreaterThan(0.8);
    expect(Math.max(...drawn.slice(-8))).toBeLessThan(0.3);
  });

  it('lifts a quiet recording so it still reads as a voice', () => {
    expect(Math.max(...resampleWaveform([0.05, 0.1, 0.08, 0.12], 4))).toBeGreaterThan(0.5);
  });

  it('refuses to amplify silence into hiss', () => {
    expect(resampleWaveform([0.001, 0.002, 0.0005, 0], 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('never draws past full height', () => {
    expect(Math.max(...resampleWaveform(speech(600), 32))).toBeLessThanOrEqual(1);
  });

  it('has nothing to draw for a recording that never started', () => {
    expect(resampleWaveform([], 128)).toEqual([]);
    expect(resampleWaveform([0.5], 0)).toEqual([]);
  });

  it('covers the whole recording, so the end is not dropped', () => {
    // A loud finish that never appears in the drawing is the bug this guards.
    const endsLoud = [0, 0, 0, 0, 0, 0, 0, 1];
    expect(resampleWaveform(endsLoud, 4).at(-1)).toBeGreaterThan(0);
  });
});
