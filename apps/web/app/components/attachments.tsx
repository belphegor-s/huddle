import type { Attachment } from '@huddle/core';
import { cx, Icon } from '@huddle/ui';
import { useState } from 'react';
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
      {images.length > 0 ? (
        <ul
          className={cx('grid max-w-md gap-1', images.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}
        >
          {images.map((image, index) => (
            <li key={image.id} className={cx(images.length === 3 && index === 0 && 'col-span-2')}>
              <button
                type="button"
                onClick={() => setOpenAt(index)}
                className="border-border bg-surface-sunken block w-full overflow-hidden rounded-lg border"
                // The box is reserved from the size recorded at upload, so the
                // message list never jumps when an image finishes loading.
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
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {rest.map((attachment) => (
        <div key={attachment.id} className="max-w-md">
          {attachment.kind === 'audio' ? (
            <VoiceNote attachment={attachment} />
          ) : attachment.kind === 'video' ? (
            <video
              src={attachment.url}
              controls
              preload="metadata"
              className="border-border max-h-80 w-full rounded-lg border"
            />
          ) : (
            <a
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="border-border bg-surface-raised hover:bg-surface-hover group flex min-h-11 items-center gap-3 rounded-lg border px-3 no-underline transition-colors"
            >
              <span className="bg-surface-sunken text-text-secondary grid size-9 shrink-0 place-items-center rounded-md">
                <Icon name="file" className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{attachment.name}</span>
                <span className="text-text-muted text-xs">{formatSize(attachment.size)}</span>
              </span>
              <Icon name="download" className="text-text-muted size-4" />
            </a>
          )}
        </div>
      ))}

      {openAt !== null ? (
        <Lightbox images={images} startAt={openAt} onClose={() => setOpenAt(null)} />
      ) : null}
    </div>
  );
}
