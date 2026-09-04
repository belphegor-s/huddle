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
  connecting?: boolean;
  /** A shared screen is letterboxed. A face fills the tile. */
  contain?: boolean;
}

export function CallTile({
  name,
  avatarUrl,
  stream,
  video,
  muted,
  speaking,
  self = false,
  connecting = false,
  contain = false,
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
      {self ? null : <audio ref={setSpeaker} autoPlay playsInline className="hidden" />}

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

      {connecting ? (
        <span className="absolute inset-0 grid place-items-center bg-black/50 text-xs text-white/80">
          Connecting
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
