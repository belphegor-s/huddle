import { Button, Icon, type IconName } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './dialog';

/** What gets uploaded. Enough for a retina display and nothing beyond it. */
const OUTPUT_PX = 512;

/** The editing surface, in CSS pixels. */
const BOX_PX = 288;

const MAX_ZOOM = 4;

/** One press is a noticeable step without overshooting the picture. */
const ZOOM_STEP = 0.25;

interface AvatarEditorProps {
  file: File;
  onCancel(): void;
  onDone(file: File): void;
}

/**
 * Crops a picture down to the square an avatar actually is.
 *
 * The point is not decoration. A photo off a phone is several thousand pixels
 * wide and a few megabytes, and it was being uploaded whole to be drawn at
 * thirty two pixels: slow to send, slow to fetch, and centred on whatever the
 * middle of the frame happened to be. This settles both, and does the work in
 * the browser so the server never handles the original at all.
 *
 * Rotation is baked into an offscreen bitmap rather than applied as a
 * transform. Preview and output then share one piece of arithmetic, so what
 * somebody positioned is exactly what gets saved.
 */
export function AvatarEditor({ file, onCancel, onDone }: AvatarEditorProps) {
  const [source, setSource] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const [turns, setTurns] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const original = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = new Image();

    element.onload = () => {
      original.current = element;
      void rotated(element, 0).then(setSource);
    };
    element.onerror = () => setProblem('That file could not be read as an image.');
    element.src = url;

    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Re-baked whenever the picture is turned, and the crop starts again from
  // the middle because the old offset means nothing in the new orientation.
  useEffect(() => {
    const element = original.current;
    if (!element) return;

    let stale = false;
    void rotated(element, turns).then((next) => {
      if (stale) {
        URL.revokeObjectURL(next.url);
        return;
      }
      setSource((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return next;
      });
    });

    setOffset({ x: 0, y: 0 });
    setZoom(1);

    return () => {
      stale = true;
    };
  }, [turns]);

  const width = source?.canvas.width ?? 0;
  const height = source?.canvas.height ?? 0;
  const cover = width > 0 && height > 0 ? BOX_PX / Math.min(width, height) : 1;
  const scale = cover * zoom;

  /** Never let the picture pull away from an edge and leave the box empty. */
  function clamp(next: { x: number; y: number }) {
    const spanX = Math.max(0, width * scale - BOX_PX);
    const spanY = Math.max(0, height * scale - BOX_PX);

    return {
      x: Math.min(0, Math.max(-spanX, next.x)),
      y: Math.min(0, Math.max(-spanY, next.y)),
    };
  }

  useEffect(
    () => setOffset((current) => clampTo(current, width, height, scale)),
    [scale, width, height],
  );

  async function save() {
    const canvas = source?.canvas;
    if (!canvas) return;

    setBusy(true);
    try {
      onDone(
        new File([await renderSquare(canvas, scale, offset)], 'avatar.webp', {
          type: 'image/webp',
        }),
      );
    } catch {
      setProblem('That picture could not be cropped. Try another one.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Crop your picture" onClose={onCancel}>
      {problem ? <p className="text-critical text-sm">{problem}</p> : null}

      <div
        className="bg-surface-sunken relative mx-auto touch-none overflow-hidden rounded-full"
        style={{ width: BOX_PX, height: BOX_PX, cursor: 'grab' }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from) return;
          setOffset(clamp({ x: event.clientX - from.x, y: event.clientY - from.y }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {source ? (
          <img
            src={source.url}
            alt=""
            draggable={false}
            className="absolute top-0 left-0 max-w-none origin-top-left select-none"
            style={{
              width: width * scale,
              height: height * scale,
              transform: `translate(${String(offset.x)}px, ${String(offset.y)}px)`,
            }}
          />
        ) : null}
      </div>

      {/*
        Buttons rather than a range input. A slider is an operating system
        widget that ignores the page's own styling, and it is a poor control
        for a value with four useful positions and no need for precision.
      */}
      <div className="flex items-center justify-center gap-2">
        <Step
          icon="minus"
          label="Zoom out"
          disabled={zoom <= 1}
          onPress={() => setZoom((was) => Math.max(1, Number((was - ZOOM_STEP).toFixed(2))))}
        />
        <span className="text-text-muted w-14 text-center font-mono text-xs tabular-nums">
          {zoom.toFixed(2)}x
        </span>
        <Step
          icon="plus"
          label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onPress={() => setZoom((was) => Math.min(MAX_ZOOM, Number((was + ZOOM_STEP).toFixed(2))))}
        />

        <span className="bg-border mx-1 h-6 w-px" />

        <Step
          icon="reply"
          label="Rotate a quarter turn"
          onPress={() => setTurns((was) => (was + 1) % 4)}
        />
        <Step
          icon="expand"
          label="Fit the whole picture"
          disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
          onPress={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
        />
      </div>

      <p className="text-text-muted text-xs">Drag to move. Saved as a {OUTPUT_PX} pixel square.</p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={busy || source === null}>
          {busy ? 'Working' : 'Use this'}
        </Button>
      </div>
    </Dialog>
  );
}

function clampTo(
  offset: { x: number; y: number },
  width: number,
  height: number,
  scale: number,
): { x: number; y: number } {
  const spanX = Math.max(0, width * scale - BOX_PX);
  const spanY = Math.max(0, height * scale - BOX_PX);

  return {
    x: Math.min(0, Math.max(-spanX, offset.x)),
    y: Math.min(0, Math.max(-spanY, offset.y)),
  };
}

/**
 * The picture turned, as a bitmap, so nothing downstream has to know about it.
 *
 * The preview is a blob URL rather than a data URL: a photo off a phone
 * becomes a several megabyte string that way, held in memory for as long as
 * the dialog is open, for no gain.
 */
async function rotated(
  image: HTMLImageElement,
  turns: number,
): Promise<{ canvas: HTMLCanvasElement; url: string }> {
  const swapped = turns % 2 === 1;
  const canvas = document.createElement('canvas');

  canvas.width = swapped ? image.naturalHeight : image.naturalWidth;
  canvas.height = swapped ? image.naturalWidth : image.naturalHeight;

  const context = canvas.getContext('2d');
  if (context) {
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turns * Math.PI) / 2);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  return { canvas, url: blob ? URL.createObjectURL(blob) : '' };
}

/**
 * Draws the visible square at the output size.
 *
 * WebP rather than the original format: an avatar is a small square, and the
 * difference against a JPEG of the same picture is tens of kilobytes on every
 * page that draws it.
 */
function renderSquare(
  source: HTMLCanvasElement,
  scale: number,
  offset: { x: number; y: number },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_PX;
  canvas.height = OUTPUT_PX;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw to a canvas.');

  // The region of the source the circle is showing, in source pixels.
  const visible = BOX_PX / scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    -offset.x / scale,
    -offset.y / scale,
    visible,
    visible,
    0,
    0,
    OUTPUT_PX,
    OUTPUT_PX,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The crop produced nothing.'))),
      'image/webp',
      0.9,
    );
  });
}

/** One control in the editing row, so they cannot drift apart. */
function Step({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="border-border bg-surface hover:bg-surface-hover grid size-11 shrink-0 place-items-center rounded-lg border transition-colors disabled:opacity-40"
    >
      <Icon name={icon} className="size-4" />
    </button>
  );
}
