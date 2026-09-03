import type { Attachment } from '@huddle/core';
import { Icon } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';

interface LightboxProps {
  images: Attachment[];
  startAt: number;
  onClose(): void;
}

/**
 * A native dialog, so focus trapping, page inertness and Escape come from the
 * platform rather than from three hooks that get one of them wrong.
 */
export function Lightbox({ images, startAt, onClose }: LightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(startAt);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') setIndex((at) => (at + 1) % images.length);
      if (event.key === 'ArrowLeft') setIndex((at) => (at - 1 + images.length) % images.length);
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [images.length]);

  const current = images[index];
  if (!current) return null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // The backdrop is the dialog itself: the image sits in a child.
        if (event.target === ref.current) ref.current?.close();
      }}
      className="max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/80"
    >
      <div className="pointer-events-none fixed inset-0 flex flex-col">
        <header className="pointer-events-auto flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
          <p className="min-w-0 flex-1 truncate text-sm">{current.name}</p>
          {images.length > 1 ? (
            <p className="text-xs text-white/70">
              {index + 1} of {images.length}
            </p>
          ) : null}
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the full size image"
            className="grid size-9 place-items-center rounded-lg text-white no-underline hover:bg-white/15"
          >
            <Icon name="download" className="size-5" />
          </a>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-lg hover:bg-white/15"
          >
            <Icon name="close" className="size-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
          <img
            src={current.url}
            alt={current.name}
            className="pointer-events-auto max-h-full max-w-full object-contain"
          />
        </div>

        {images.length > 1 ? (
          <>
            <Step
              side="left"
              label="Previous image"
              onClick={() => setIndex((at) => (at - 1 + images.length) % images.length)}
            />
            <Step
              side="right"
              label="Next image"
              onClick={() => setIndex((at) => (at + 1) % images.length)}
            />
          </>
        ) : null}
      </div>
    </dialog>
  );
}

function Step({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`pointer-events-auto absolute top-1/2 ${side === 'left' ? 'left-2' : 'right-2'} grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60`}
    >
      <Icon name="chevronLeft" className={side === 'right' ? 'size-5 rotate-180' : 'size-5'} />
    </button>
  );
}
