import type { Attachment } from '@huddle/core';
import { Icon, IconSolid } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * The waveform is drawn from peaks computed at record time and carried on the
 * attachment, so playback never decodes the audio to draw anything. Scrubbing
 * works before a single byte of the file has been fetched.
 */
export function VoiceNote({ attachment }: { attachment: Attachment }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const peaks = attachment.peaks ?? [];
  const total = attachment.durationMs ?? 0;

  useEffect(() => {
    const element = audio.current;
    if (!element) return;

    const onTime = () =>
      setProgress(element.duration > 0 ? element.currentTime / element.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };

    element.addEventListener('timeupdate', onTime);
    element.addEventListener('ended', onEnd);
    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('ended', onEnd);
    };
  }, []);

  function toggle() {
    const element = audio.current;
    if (!element) return;

    if (playing) element.pause();
    else void element.play();
    setPlaying(!playing);
  }

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const element = audio.current;
    if (!element || !Number.isFinite(element.duration)) return;

    const box = event.currentTarget.getBoundingClientRect();
    element.currentTime = ((event.clientX - box.left) / box.width) * element.duration;
  }

  return (
    <div className="border-border bg-surface-raised flex items-center gap-3 rounded-lg border px-3 py-2">
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
          // Filled, and nudged right, because an outlined triangle inside a
          // circle reads as disabled and its optical centre sits left.
          <IconSolid name="play" className="size-4 translate-x-px" />
        )}
      </button>

      <div
        onClick={seek}
        role="presentation"
        className="flex h-9 flex-1 items-center gap-px overflow-hidden"
      >
        {peaks.map((peak, index) => (
          <span
            key={index}
            className={
              index / Math.max(peaks.length, 1) <= progress ? 'bg-accent' : 'bg-border-strong'
            }
            style={{ height: `${Math.max(3, peak * 100)}%`, width: '2px', borderRadius: '1px' }}
          />
        ))}
      </div>

      <span className="text-text-muted shrink-0 font-mono text-xs">{formatDuration(total)}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
