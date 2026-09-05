import { Avatar, cx, Icon } from '@huddle/ui';
import { useEffect, useState } from 'react';

interface CallTileProps {
  name: string;
  avatarUrl: string | null;
  stream: MediaStream | null;
  /** Whether the stream is worth showing, which is not the same as having one. */
  video: boolean;
  muted: boolean;
  speaking: boolean;
  /** Your own tile is silent, or you hear yourself a beat late. */
  self?: boolean;
  /** A shared screen carries no voice, so it needs no speaker of its own. */
  silent?: boolean;
  connecting?: boolean;
  /** Tried and could not. Said plainly rather than left as "Connecting". */
  failed?: boolean;
  /** A shared screen is letterboxed. A face fills the tile. */
  contain?: boolean;
  pinned?: boolean;
  /** Absent where pinning makes no sense, which hides the control entirely. */
  onPin?(): void;
}

export function CallTile({
  name,
  avatarUrl,
  stream,
  video,
  muted,
  speaking,
  self = false,
  silent = false,
  connecting = false,
  failed = false,
  contain = false,
  pinned = false,
  onPin,
}: CallTileProps) {
  // Held in state rather than in a ref because they appear and disappear:
  // turning a camera on replaces the avatar with a video element without the
  // stream changing, and an effect keyed on the stream alone would never run
  // again to attach it.
  const [player, setPlayer] = useState<HTMLVideoElement | null>(null);
  const [speaker, setSpeaker] = useState<HTMLAudioElement | null>(null);

  // srcObject is a property rather than an attribute, so it cannot be set in
  // JSX and has to be attached once the element exists.
  useEffect(() => attach(player, stream), [player, stream]);
  useEffect(() => attach(speaker, stream), [speaker, stream]);

  return (
    <div
      className={cx(
        'group relative isolate flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-xl bg-black/80',
        'motion-safe:transition-shadow',
        speaking ? 'ring-accent ring-2 ring-inset' : 'ring-0',
      )}
    >
      {/*
        Sound comes from here and never from the video, because the video is
        only mounted while a camera is on: with it off there was no element
        holding the stream at all and the room went silent until somebody
        turned a camera on. Keeping the two apart also means the picture can
        come and go without interrupting the audio.
      */}
      {self || silent ? null : <audio ref={setSpeaker} autoPlay playsInline className="hidden" />}

      {video && stream ? (
        <video
          ref={setPlayer}
          autoPlay
          playsInline
          // Always silent. The audio element above is the one that plays.
          muted
          className={cx(
            'h-full w-full',
            contain ? 'object-contain' : 'object-cover',
            // Your own camera is a mirror. Everybody else is not.
            self && !contain && 'scale-x-[-1]',
          )}
        />
      ) : (
        <Avatar name={name} url={avatarUrl} size="lg" />
      )}

      {/*
        Hidden until the tile is hovered, and always present on a touch screen
        where there is no hover to reveal it. A pin that can only be found by
        waving a mouse around is a pin most people never find.
      */}
      {onPin ? (
        <button
          type="button"
          onClick={onPin}
          aria-pressed={pinned}
          aria-label={
            pinned ? `Unpin ${self ? 'yourself' : name}` : `Pin ${self ? 'yourself' : name}`
          }
          title={pinned ? 'Unpin' : 'Pin to the stage'}
          className={cx(
            'absolute top-1.5 right-1.5 z-10 grid size-8 place-items-center rounded-lg transition-opacity',
            pinned
              ? 'bg-accent text-white opacity-100'
              : 'bg-black/50 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <Icon name="pin" className="size-4" />
        </button>
      ) : null}

      {failed || connecting ? (
        <span className="absolute inset-0 grid place-items-center bg-black/50 px-2 text-center text-xs text-white/80">
          {failed ? 'Could not connect' : 'Connecting'}
        </span>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2">
        {muted ? (
          <Icon name="micOff" label="Muted" className="size-3.5 shrink-0 text-white/90" />
        ) : null}
        <span className="truncate text-xs font-medium text-white/90">{self ? 'You' : name}</span>
      </div>
    </div>
  );
}

function attach(element: HTMLMediaElement | null, stream: MediaStream | null): void {
  if (!element || element.srcObject === stream) return;

  element.srcObject = stream;
  // Autoplay can be refused, and there is nothing useful to do about it here.
  if (stream) void element.play().catch(() => undefined);
}
