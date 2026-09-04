import { resampleWaveform, type Attachment } from '@huddle/core';
import { cx, Icon, IconSolid } from '@huddle/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '../lib/format';

/** Silence still needs a line, or the bar looks like a rendering failure. */
const FLOOR_PERCENT = 15;

/**
 * Fewer bars than are stored. A hundred and twenty eight of them in a chat
 * bubble comes out a pixel wide each, which reads as interference rather than
 * a voice. The extra detail stays on the attachment for anywhere wider.
 */
const DRAWN_BARS = 48;

/** Arrow keys move by this much of the note, which is how every player behaves. */
const STEP_FRACTION = 0.05;

/**
 * The waveform is drawn from peaks computed at record time and carried on the
 * attachment, so playback never decodes the audio to draw anything. Scrubbing
 * works before a single byte of the file has been fetched.
 */
export function VoiceNote({ attachment }: { attachment: Attachment }) {
  const audio = useRef<HTMLAudioElement>(null);
  /**
   * Where the listener scrubbed to before the file had loaded. Nothing is
   * fetched until play is pressed, so the element has no duration yet and
   * cannot be told a position: it is applied once it knows how long it is.
   */
  const pending = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const total = attachment.durationMs ?? 0;
  const peaks = useMemo(
    () => resampleWaveform(attachment.peaks ?? [], DRAWN_BARS),
    [attachment.peaks],
  );

  useEffect(() => {
    const element = audio.current;
    if (!element) return;

    const onTime = () =>
      setProgress(element.duration > 0 ? element.currentTime / element.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onReady = () => {
      const at = pending.current;
      pending.current = null;
      if (at !== null && element.duration > 0) element.currentTime = at * element.duration;
    };

    element.addEventListener('timeupdate', onTime);
    element.addEventListener('ended', onEnd);
    element.addEventListener('pause', onPause);
    element.addEventListener('play', onPlay);
    element.addEventListener('loadedmetadata', onReady);
    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('ended', onEnd);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('loadedmetadata', onReady);
    };
  }, []);

  function toggle() {
    const element = audio.current;
    if (!element) return;

    // The state follows the element's own events rather than being set here,
    // so a play that never starts does not leave a pause button behind.
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }

  /** Where a click landed, as a fraction, clamped to the bar. */
  function seekTo(fraction: number) {
    const clamped = Math.min(1, Math.max(0, fraction));
    setProgress(clamped);

    const element = audio.current;
    if (element && Number.isFinite(element.duration) && element.duration > 0) {
      element.currentTime = clamped * element.duration;
    } else {
      pending.current = clamped;
    }
  }

  function onPointer(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    seekTo((event.clientX - box.left) / box.width);
  }

  return (
    <div className="border-border bg-surface-raised flex max-w-md items-center gap-3 rounded-xl border px-3 py-2">
      <audio ref={audio} src={attachment.url} preload="none" />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className="bg-accent text-on-accent hover:bg-accent-hover grid size-9 shrink-0 place-items-center rounded-full transition-colors"
      >
        {playing ? (
          <Icon name="pause" className="size-4" />
        ) : (
          // Filled, because an outlined triangle inside a circle reads as
          // disabled. The nudge it used to carry is gone: the glyph is centred
          // in its own box now.
          <IconSolid name="play" className="size-4" />
        )}
      </button>

      {/*
        A slider, not a decorated div. Scrubbing was mouse only, which left the
        middle of a two minute note unreachable without one.
      */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek within the voice note"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={formatDuration(progress * total)}
        onPointerDown={onPointer}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') seekTo(progress + STEP_FRACTION);
          else if (event.key === 'ArrowLeft') seekTo(progress - STEP_FRACTION);
          else if (event.key === 'Home') seekTo(0);
          else if (event.key === 'End') seekTo(1);
          else if (event.key === ' ' || event.key === 'Enter') toggle();
          else return;

          event.preventDefault();
        }}
        className="flex h-9 flex-1 cursor-pointer touch-none items-center gap-[3px]"
      >
        {peaks.length === 0 ? (
          <span className="bg-border-strong h-0.5 w-full rounded-full" />
        ) : (
          peaks.map((peak, index) => (
            <span
              key={index}
              className={cx(
                'min-w-[2px] flex-1 rounded-full motion-safe:transition-colors',
                // A bar is played once the playhead has passed its middle, so
                // the colour changes when the bar is actually being heard.
                (index + 0.5) / peaks.length <= progress ? 'bg-accent' : 'bg-border-strong',
              )}
              style={{ height: `${String(FLOOR_PERCENT + peak * (100 - FLOOR_PERCENT))}%` }}
            />
          ))
        )}
      </div>

      <span className="text-text-muted shrink-0 font-mono text-xs tabular-nums">
        {formatDuration(playing || progress > 0 ? progress * total : total)}
      </span>
    </div>
  );
}
