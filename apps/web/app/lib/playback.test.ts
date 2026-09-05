import { describe, expect, it } from 'vitest';
import { barIsPlayed, barsThatFit, fractionPlayed, lengthInSeconds } from './playback';

describe('lengthInSeconds', () => {
  it('believes the element when it knows', () => {
    expect(lengthInSeconds({ reported: 12.5, recordedMs: 12_000 })).toBe(12.5);
  });

  it('falls back to what the recorder measured when the element says NaN', () => {
    // The bug this exists for. A file from MediaRecorder carries no duration
    // in its header, so the element reports NaN and every position computed
    // from it is NaN: the highlight never moves.
    expect(lengthInSeconds({ reported: Number.NaN, recordedMs: 4_200 })).toBe(4.2);
  });

  it('falls back when the element says the stream is endless', () => {
    expect(lengthInSeconds({ reported: Number.POSITIVE_INFINITY, recordedMs: 3_000 })).toBe(3);
  });

  it('falls back when the element says zero', () => {
    expect(lengthInSeconds({ reported: 0, recordedMs: 5_000 })).toBe(5);
  });

  it('has nothing to offer when neither source knows', () => {
    expect(lengthInSeconds({ reported: Number.NaN, recordedMs: 0 })).toBe(0);
  });
});

describe('fractionPlayed', () => {
  it('reports how far through it is', () => {
    expect(fractionPlayed(3, 12)).toBe(0.25);
  });

  it('never returns Infinity when the length is not known', () => {
    // Unguarded this is Infinity, which reaches the markup as a position of
    // Infinity per cent and lights every bar at once.
    expect(fractionPlayed(3, 0)).toBe(0);
    expect(fractionPlayed(3, Number.NaN)).toBe(0);
  });

  it('never returns NaN', () => {
    expect(fractionPlayed(Number.NaN, 10)).toBe(0);
  });

  it('stays inside the bar', () => {
    // A position past the end is normal for a moment when a file is slightly
    // longer than the length the recorder measured.
    expect(fractionPlayed(11, 10)).toBe(1);
    expect(fractionPlayed(-1, 10)).toBe(0);
  });
});

describe('barIsPlayed', () => {
  it('lights a bar once the playhead has passed its middle', () => {
    expect(barIsPlayed(0, 4, 0.1)).toBe(false);
    expect(barIsPlayed(0, 4, 0.2)).toBe(true);
  });

  it('lights everything at the end and nothing at the start', () => {
    expect([0, 1, 2, 3].map((index) => barIsPlayed(index, 4, 1))).toEqual([true, true, true, true]);
    expect([0, 1, 2, 3].map((index) => barIsPlayed(index, 4, 0))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('lights nothing when there are no bars', () => {
    expect(barIsPlayed(0, 0, 1)).toBe(false);
  });
});

describe('barsThatFit', () => {
  it('fills a wide bubble with every bar there is', () => {
    expect(barsThatFit(600)).toBe(48);
  });

  it('thins out rather than overflowing a narrow one', () => {
    // 40 bars at two pixels with three between them is 197.
    expect(barsThatFit(200)).toBe(40);
    expect(barsThatFit(120)).toBe(24);
  });

  it('never draws so few that it stops reading as a voice', () => {
    expect(barsThatFit(10)).toBe(12);
  });

  it('has an answer before anything has been measured', () => {
    expect(barsThatFit(0)).toBe(12);
    expect(barsThatFit(Number.NaN)).toBe(12);
  });

  it('draws bars that actually fit', () => {
    for (const width of [80, 137, 200, 260, 320, 480]) {
      const bars = barsThatFit(width);
      const needed = bars * 2 + (bars - 1) * 3;
      // The floor of twelve is allowed to overflow a track nothing could fill.
      if (bars > 12)
        expect(needed, `${String(bars)} bars in ${String(width)}px`).toBeLessThanOrEqual(width);
    }
  });
});
