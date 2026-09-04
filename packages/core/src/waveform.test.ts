import { describe, expect, it } from 'vitest';
import { resampleWaveform } from './waveform.js';

describe('resampleWaveform', () => {
  it('gives a short recording a full waveform rather than one bar', () => {
    // What a three second note used to produce: a handful of samples for a
    // drawing that wants a hundred and twenty eight bars.
    const short = [0.4, 0.9, 0.2, 0.7];
    const drawn = resampleWaveform(short, 128);

    expect(drawn).toHaveLength(128);
    expect(drawn.every((value) => value > 0)).toBe(true);
  });

  it('reduces a long recording to the width of the drawing', () => {
    const long = Array.from({ length: 6000 }, (_, index) => (index % 100) / 100);
    expect(resampleWaveform(long, 128)).toHaveLength(128);
  });

  it('keeps the loudest moment in each window, not the average', () => {
    // Speech is mostly gaps. Averaging flattens it into a straight line.
    const spiky = [0, 0, 1, 0, 0, 0, 0, 0];
    const [first, second] = resampleWaveform(spiky, 2);

    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('lifts a quiet recording so it still reads as a voice', () => {
    const quiet = [0.05, 0.1, 0.08, 0.12];
    const drawn = resampleWaveform(quiet, 4);

    expect(Math.max(...drawn)).toBeGreaterThan(0.5);
  });

  it('refuses to amplify silence into hiss', () => {
    const silence = [0.001, 0.002, 0.0005, 0];
    expect(resampleWaveform(silence, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('never draws past full height', () => {
    const loud = [0.9, 1, 0.95, 1];
    expect(Math.max(...resampleWaveform(loud, 16))).toBeLessThanOrEqual(1);
  });

  it('has nothing to draw for a recording that never started', () => {
    expect(resampleWaveform([], 128)).toEqual([]);
    expect(resampleWaveform([0.5], 0)).toEqual([]);
  });

  it('covers the whole recording, so the end is not dropped', () => {
    // The last window must reach the final sample. A loud finish that never
    // appears in the drawing is the bug this guards.
    const endsLoud = [0, 0, 0, 0, 0, 0, 0, 1];
    expect(resampleWaveform(endsLoud, 4).at(-1)).toBe(1);
  });
});
