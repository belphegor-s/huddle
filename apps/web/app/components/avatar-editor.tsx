import { Button, Icon, Spinner, type IconName } from '@huddle/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from './dialog';

/** What gets uploaded. Enough for a retina display and nothing beyond it. */
const OUTPUT_PX = 512;

/** The circle that will be kept, in CSS pixels. */
const CROP_PX = 232;

/**
 * The working area around it. Larger than the crop on purpose: what is being
 * cut off stays visible and dimmed, so the choice is made by looking at the
 * whole picture rather than by guessing at what lies outside a hole.
 */
const FRAME_PX = 300;

const PAD = (FRAME_PX - CROP_PX) / 2;

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.2;

interface AvatarEditorProps {
  file: File;
  onCancel(): void;
  onDone(file: File): void;
}

interface Source {
  canvas: HTMLCanvasElement;
  url: string;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Crops a picture down to the square an avatar actually is.
 *
 * A photo off a phone is several thousand pixels wide and a few megabytes, and
 * it was being uploaded whole to be drawn at thirty two pixels: slow to send,
 * slow to fetch, and centred on whatever the middle of the frame happened to
 * be. This settles both, and does the work in the browser so the server never
 * handles the original at all.
 *
 * Rotation is baked into an offscreen bitmap rather than applied as a
 * transform. Preview and output then share one piece of arithmetic, so what
 * somebody positioned is exactly what gets saved.
 */
export function AvatarEditor({ file, onCancel, onDone }: AvatarEditorProps) {
  const [source, setSource] = useState<Source | null>(null);
  const [turns, setTurns] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Point>({ x: PAD, y: PAD });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const grab = useRef<Point | null>(null);
  const pinch = useRef<number | null>(null);
  const original = useRef<HTMLImageElement | null>(null);

  const width = source?.canvas.width ?? 0;
  const height = source?.canvas.height ?? 0;

  // Cover the circle, not the frame. Anything less would leave a gap inside
  // the part being kept.
  const cover = width > 0 && height > 0 ? CROP_PX / Math.min(width, height) : 1;
  const scale = cover * zoom;

  /** Keeps the picture over the circle, whatever is done to it. */
  const clamp = useCallback(
    (point: Point, at: number): Point => ({
      x: Math.min(PAD, Math.max(PAD + CROP_PX - width * at, point.x)),
      y: Math.min(PAD, Math.max(PAD + CROP_PX - height * at, point.y)),
    }),
    [width, height],
  );

  /** Centres the picture in the circle at a given scale. */
  const centred = useCallback(
    (at: number): Point =>
      clamp({ x: PAD + (CROP_PX - width * at) / 2, y: PAD + (CROP_PX - height * at) / 2 }, at),
    [clamp, width, height],
  );

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
  // the middle because the old position means nothing in the new orientation.
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
      setZoom(MIN_ZOOM);
    });

    return () => {
      stale = true;
    };
  }, [turns]);

  // Re-centred whenever the picture changes size under it.
  useEffect(() => {
    if (width === 0) return;
    setOffset(centred(cover * MIN_ZOOM));
  }, [width, height, cover, centred]);

  /** Zooms about the middle of the circle, so the subject stays put. */
  const zoomTo = useCallback(
    (next: number) => {
      const wanted = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next.toFixed(3))));
      const middle = PAD + CROP_PX / 2;

      setZoom((was) => {
        const before = cover * was;
        const after = cover * wanted;

        setOffset((current) =>
          clamp(
            {
              x: middle - ((middle - current.x) / before) * after,
              y: middle - ((middle - current.y) / before) * after,
            },
            after,
          ),
        );

        return wanted;
      });
    },
    [clamp, cover],
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
      setBusy(false);
    }
  }

  return (
    <Dialog title="Crop your picture" onClose={onCancel}>
      {problem ? <p className="text-critical text-sm">{problem}</p> : null}

      <div className="flex flex-col items-center gap-4">
        <div
          role="application"
          aria-label="Drag to move the picture. Arrow keys nudge it, plus and minus zoom."
          tabIndex={0}
          className="bg-surface-sunken relative shrink-0 touch-none overflow-hidden rounded-xl select-none"
          style={{ width: FRAME_PX, height: FRAME_PX, cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={(event) => {
            grab.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const from = grab.current;
            if (!from) return;
            setOffset(clamp({ x: event.clientX - from.x, y: event.clientY - from.y }, scale));
          }}
          onPointerUp={() => {
            grab.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            grab.current = null;
            setDragging(false);
          }}
          onWheel={(event) => zoomTo(zoom - event.deltaY / 500)}
          onTouchMove={(event) => {
            // Pinch, which is how anybody on a phone expects to zoom.
            if (event.touches.length !== 2) return;

            const first = event.touches[0];
            const second = event.touches[1];
            if (!first || !second) return;

            const spread = Math.hypot(
              first.clientX - second.clientX,
              first.clientY - second.clientY,
            );
            const previous = pinch.current;
            pinch.current = spread;

            if (previous !== null && previous > 0) zoomTo(zoom * (spread / previous));
          }}
          onTouchEnd={() => (pinch.current = null)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 20 : 5;
            const moves: Record<string, Point> = {
              ArrowLeft: { x: -step, y: 0 },
              ArrowRight: { x: step, y: 0 },
              ArrowUp: { x: 0, y: -step },
              ArrowDown: { x: 0, y: step },
            };

            const move = moves[event.key];
            if (move) {
              event.preventDefault();
              setOffset((current) =>
                clamp({ x: current.x + move.x, y: current.y + move.y }, scale),
              );
              return;
            }

            if (event.key === '+' || event.key === '=') zoomTo(zoom + ZOOM_STEP);
            if (event.key === '-') zoomTo(zoom - ZOOM_STEP);
          }}
        >
          {source ? (
            <img
              src={source.url}
              alt=""
              draggable={false}
              className="absolute top-0 left-0 max-w-none select-none"
              style={{
                width: width * scale,
                height: height * scale,
                transform: `translate(${String(offset.x)}px, ${String(offset.y)}px)`,
              }}
            />
          ) : (
            <span className="text-text-muted absolute inset-0 grid place-items-center">
              <Spinner />
            </span>
          )}

          {/*
            One element does the dimming and the ring: an enormous spread
            shadow fills everything outside the circle, which is exact at any
            size and needs no second layer to line up with.
          */}
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full"
            style={{
              inset: `${String(PAD)}px`,
              // Both in one declaration. Tailwind draws a ring with a box
              // shadow too, so setting this inline silently threw the ring
              // away and left the circle with no edge at all.
              boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.85), 0 0 0 9999px rgb(0 0 0 / 0.62)',
            }}
          />

          {/* Guides, only while moving, so they help rather than decorate. */}
          {dragging ? <Guides /> : null}
        </div>

        <div className="flex w-full min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Preview source={source} scale={scale} offset={offset} />
          </div>

          <div className="flex items-center justify-center gap-1.5">
            <Step
              icon="minus"
              label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onPress={() => zoomTo(zoom - ZOOM_STEP)}
            />
            <span className="text-text-muted w-12 text-center font-mono text-xs tabular-nums">
              {zoom.toFixed(1)}x
            </span>
            <Step
              icon="plus"
              label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onPress={() => zoomTo(zoom + ZOOM_STEP)}
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
              disabled={zoom === MIN_ZOOM}
              onPress={() => {
                setZoom(MIN_ZOOM);
                setOffset(centred(cover * MIN_ZOOM));
              }}
            />
          </div>

          <p className="text-text-muted text-xs">
            Drag to move, scroll or pinch to zoom. Saved as a {OUTPUT_PX} pixel square.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={busy || source === null}>
          {busy ? <Spinner /> : null}
          {busy ? 'Working' : 'Use this'}
        </Button>
      </div>
    </Dialog>
  );
}

/** Thirds, drawn only while the picture is being moved. */
function Guides() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute overflow-hidden rounded-full"
      style={{ inset: `${String(PAD)}px` }}
    >
      {[33.33, 66.66].map((at) => (
        <span key={`x${String(at)}`}>
          <span
            className="absolute top-0 bottom-0 w-px bg-white/40"
            style={{ left: `${String(at)}%` }}
          />
          <span
            className="absolute right-0 left-0 h-px bg-white/40"
            style={{ top: `${String(at)}%` }}
          />
        </span>
      ))}
    </span>
  );
}

/** The result, at the sizes it will actually be seen at. */
function Preview({
  source,
  scale,
  offset,
}: {
  source: Source | null;
  scale: number;
  offset: Point;
}) {
  return (
    <div className="flex items-center gap-3">
      {([56, 32] as const).map((size) => {
        const ratio = size / CROP_PX;

        return (
          <span
            key={size}
            className="bg-surface-sunken relative shrink-0 overflow-hidden rounded-full"
            style={{ width: size, height: size }}
          >
            {source ? (
              <img
                src={source.url}
                alt=""
                draggable={false}
                className="absolute top-0 left-0 max-w-none"
                style={{
                  width: source.canvas.width * scale * ratio,
                  height: source.canvas.height * scale * ratio,
                  transform: `translate(${String((offset.x - PAD) * ratio)}px, ${String(
                    (offset.y - PAD) * ratio,
                  )}px)`,
                }}
              />
            ) : null}
          </span>
        );
      })}
      <span className="text-text-muted text-xs">How it will look</span>
    </div>
  );
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
      className="border-border bg-surface hover:bg-surface-hover grid size-10 shrink-0 place-items-center rounded-lg border transition-colors disabled:opacity-40"
    >
      <Icon name={icon} className="size-4" />
    </button>
  );
}

/**
 * The picture turned, as a bitmap, so nothing downstream has to know about it.
 *
 * The preview is a blob URL rather than a data URL: a photo off a phone
 * becomes a several megabyte string that way, held in memory for as long as
 * the dialog is open, for no gain.
 */
async function rotated(image: HTMLImageElement, turns: number): Promise<Source> {
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
 * Draws the circle's square at the output size.
 *
 * WebP rather than the original format: an avatar is a small square, and the
 * difference against a JPEG of the same picture is tens of kilobytes on every
 * page that draws it.
 */
function renderSquare(source: HTMLCanvasElement, scale: number, offset: Point): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_PX;
  canvas.height = OUTPUT_PX;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw to a canvas.');

  // The region of the source the circle is over, in source pixels.
  const visible = CROP_PX / scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    (PAD - offset.x) / scale,
    (PAD - offset.y) / scale,
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
