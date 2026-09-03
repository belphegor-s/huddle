import type { Attachment } from '@huddle/core';
import { cx, Icon } from '@huddle/ui';
import { useState } from 'react';
import { lookOf } from '../lib/file-kind';
import { formatSize } from '../lib/format';
import { Lightbox } from './lightbox';
import { VoiceNote } from './voice-note';

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  if (attachments.length === 0) return null;

  const images = attachments.filter((attachment) => attachment.kind === 'image');
  const rest = attachments.filter((attachment) => attachment.kind !== 'image');

  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.length > 0 ? <ImageGrid images={images} onOpen={setOpenAt} /> : null}

      {rest.map((attachment) => (
        <div key={attachment.id} className="max-w-md">
          <Other attachment={attachment} />
        </div>
      ))}

      {openAt !== null ? (
        <Lightbox images={images} startAt={openAt} onClose={() => setOpenAt(null)} />
      ) : null}
    </div>
  );
}

/**
 * One image keeps its own proportions, several become a grid. The box is
 * always reserved from the size recorded at upload, so the conversation never
 * jumps as pictures finish loading.
 */
function ImageGrid({ images, onOpen }: { images: Attachment[]; onOpen(index: number): void }) {
  return (
    <ul className={cx('grid max-w-md gap-1', images.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
      {images.map((image, index) => (
        <li key={image.id} className={cx(images.length === 3 && index === 0 && 'col-span-2')}>
          <button
            type="button"
            onClick={() => onOpen(index)}
            aria-label={`Open ${image.name}`}
            className="border-border bg-surface-sunken block w-full overflow-hidden rounded-lg border"
            style={{
              aspectRatio:
                images.length === 1 && image.width && image.height
                  ? `${image.width} / ${image.height}`
                  : '4 / 3',
            }}
          >
            <img
              src={image.url}
              alt={image.name}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-(--duration-settle) hover:scale-[1.02]"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Other({ attachment }: { attachment: Attachment }) {
  if (attachment.kind === 'video') {
    return (
      <video
        src={attachment.url}
        controls
        preload="metadata"
        className="border-border max-h-80 w-full rounded-lg border"
      />
    );
  }

  /*
   * A voice note carries a waveform computed while it was recorded. An audio
   * file someone uploaded has none, and drawing an empty waveform for it would
   * look like a player that failed rather than a file that was never recorded
   * here, so it gets the plain control instead.
   */
  if (attachment.kind === 'audio') {
    if (attachment.peaks && attachment.peaks.length > 0)
      return <VoiceNote attachment={attachment} />;

    return (
      <div className="border-border bg-surface-raised flex flex-col gap-2 rounded-lg border p-3">
        <span className="flex items-center gap-2">
          <Icon name="mic" className="text-text-muted size-4" />
          <span className="min-w-0 flex-1 truncate text-sm">{attachment.name}</span>
          <span className="text-text-muted text-xs">{formatSize(attachment.size)}</span>
        </span>
        <audio src={attachment.url} controls preload="metadata" className="w-full" />
      </div>
    );
  }

  const look = lookOf(attachment.name, attachment.mimeType);

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="border-border bg-surface-raised hover:bg-surface-hover hover:border-border-strong group flex min-h-14 items-center gap-3 rounded-lg border px-3 no-underline transition-colors"
    >
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-lg', look.tone)}>
        <Icon name={look.icon} className="size-5" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{attachment.name}</span>
        <span className="text-text-muted text-xs">
          {look.label} · {formatSize(attachment.size)}
        </span>
      </span>

      <Icon
        name="download"
        className="text-text-muted group-hover:text-text-primary size-4 transition-colors"
      />
    </a>
  );
}
