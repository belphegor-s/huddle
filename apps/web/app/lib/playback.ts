/**
 * The arithmetic behind a playback position.
 *
 * Pulled out of the player because it is where the bugs live and none of them
 * need a browser to demonstrate. A media element is an unreliable narrator
 * about its own length, and every position is a division by that length.
 */

/** What a media element reports before it knows, or when it never will. */
export interface MediaLength {
  /** `duration` from the element: NaN before load, Infinity for some streams. */
  reported: number;
  /** What the recorder measured, carried on the attachment. */
  recordedMs: number;
}

/**
 * How long a recording is, in seconds.
 *
 * The element is not the authority. A file from MediaRecorder carries no
 * duration in its header, so `duration` reads NaN until the whole thing has
 * been decoded, and on some browsers never resolves at all. Every position
 * worked out from it is then NaN, which is why the highlight sat still for
 * the length of the note.
 */
export function lengthInSeconds({ reported, recordedMs }: MediaLength): number {
  if (Number.isFinite(reported) && reported > 0) return reported;
  return recordedMs > 0 ? recordedMs / 1000 : 0;
}

/**
 * How far through, between nothing and everything.
 *
 * Dividing by a length that is not known yet gives NaN or Infinity, and either
 * reaching the markup is how a progress bar ends up claiming a position of
 * Infinity per cent, or a waveform lights every bar at once.
 */
export function fractionPlayed(currentTime: number, seconds: number): number {
  if (seconds <= 0 || !Number.isFinite(seconds)) return 0;

  const fraction = currentTime / seconds;
  if (!Number.isFinite(fraction)) return 0;

  return Math.min(1, Math.max(0, fraction));
}

/** Whether a bar has been reached, judged by its middle rather than its edge. */
export function barIsPlayed(index: number, count: number, played: number): boolean {
  if (count <= 0) return false;
  return (index + 0.5) / count <= played;
}
