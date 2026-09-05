import type { MemberProfile } from '@huddle/core';
import { cx, Icon, type IconName } from '@huddle/ui';
import { useEffect, useState } from 'react';
import type { CallSession, CallView, PeerView } from '../lib/call';
import { CallSettings, type CallLayout } from './call-settings';
import { CallTile } from './call-tile';

interface CallStageProps {
  session: CallSession;
  call: CallView;
  members: MemberProfile[];
  meId: string;
  onToggleMuted(): void;
  onToggleVideo(): void;
  onToggleSharing(): void;
  onLeave(): void;
}

/**
 * The call, above the conversation rather than on top of it, because a huddle
 * is something people keep talking in chat during. It takes a share of the
 * height and gives the rest back to the messages.
 *
 * Expanded, it takes the screen instead, which is what a call with a screen
 * being shared in it is actually for. Real fullscreen is asked for as well,
 * and if the browser refuses the call still fills the window, so the control
 * never does nothing.
 */
export function CallStage({
  session,
  call,
  members,
  meId,
  onToggleMuted,
  onToggleVideo,
  onToggleSharing,
  onLeave,
}: CallStageProps) {
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  /**
   * Whose tile takes the stage, chosen rather than guessed. A shared screen
   * takes it on its own, and pinning somebody overrides that: the person
   * drawing on the whiteboard is not always the person sharing it.
   */
  const [pinned, setPinned] = useState<string | null>(null);
  const [layout, setLayout] = useState<CallLayout>('auto');

  // Escape leaves fullscreen on its own, and this keeps our own idea of the
  // size honest when it does. It also covers the case where the browser
  // refused fullscreen and Escape is the only way back.
  useEffect(() => {
    if (!expanded) return;

    function onFullscreenChange() {
      if (document.fullscreenElement === null) setExpanded(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setExpanded(false);
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  // Asked for rather than assumed: fullscreen needs a gesture and can be
  // refused outright, and neither is a reason to leave the control broken.
  useEffect(() => {
    if (!stage) return;

    if (expanded && document.fullscreenElement === null) {
      void stage.requestFullscreen().catch(() => undefined);
    }
    if (!expanded && document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [expanded, stage]);

  const me = members.find((member) => member.id === meId);

  // A pin outlives the person leaving, so it is cleared rather than left
  // pointing at a tile that is no longer there.
  const stillHere =
    pinned !== null && (pinned === 'self' || call.peers.some((one) => one.sessionId === pinned));
  const focus = stillHere ? pinned : null;

  /*
   * Grid never gives anybody the stage, even while a screen is being shared.
   * Spotlight always does, falling back to whoever is speaking when nothing
   * has been pinned and nothing is being shared.
   */
  const automatic = call.sharing
    ? { stream: call.screen, name: 'Your screen', contain: true, self: true }
    : screenOf(call.peers, members);

  const shared =
    layout === 'grid'
      ? null
      : focus
        ? focusedTile(focus, call, members, me)
        : (automatic ?? (layout === 'spotlight' ? loudestTile(call, members, me) : null));

  const tiles = [
    <CallTile
      key="self"
      self
      name={me?.displayName ?? 'You'}
      avatarUrl={me?.avatarUrl ?? null}
      stream={call.camera}
      video={call.video}
      muted={call.muted}
      speaking={call.speaking}
      pinned={focus === 'self'}
      onPin={() => setPinned(focus === 'self' ? null : 'self')}
    />,
    ...call.peers.map((peer) => {
      const member = members.find((one) => one.id === peer.userId);

      return (
        <CallTile
          key={peer.sessionId}
          name={member?.displayName ?? 'Someone'}
          avatarUrl={member?.avatarUrl ?? null}
          stream={peer.camera}
          video={peer.video}
          muted={peer.muted}
          speaking={peer.speaking}
          connecting={peer.link === 'connecting'}
          pinned={focus === peer.sessionId}
          onPin={() => setPinned(focus === peer.sessionId ? null : peer.sessionId)}
        />
      );
    }),
  ];

  return (
    <section
      ref={setStage}
      aria-label="Huddle"
      className={cx(
        'flex flex-col gap-2 bg-neutral-950 p-2 text-white',
        expanded
          ? 'fixed inset-0 z-50 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]'
          : 'border-border shrink-0 border-b',
      )}
    >
      {shared ? (
        <div
          className={cx(
            'flex min-h-0 flex-col gap-2 lg:flex-row',
            expanded && 'flex-1 overflow-hidden',
          )}
        >
          <div className={cx('min-h-48 flex-1', expanded ? 'lg:min-h-0' : 'lg:min-h-64')}>
            <CallTile
              contain={shared.contain}
              name={shared.name}
              avatarUrl={null}
              stream={shared.stream}
              video
              muted={false}
              speaking={false}
              self={shared.self}
              pinned={focus !== null}
              onPin={() => setPinned(null)}
            />
          </div>

          {/*
            A strip rather than the grid, so the screen keeps the room. Whoever
            is on the stage is left out of it: the same face in two places at
            once reads as a rendering fault rather than as emphasis.
          */}
          <ul className="flex gap-2 overflow-x-auto lg:w-40 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto">
            {tiles
              .filter((tile) => tile.key !== focus)
              .map((tile) => (
                <li key={tile.key} className="aspect-video w-28 shrink-0 lg:w-full">
                  {tile}
                </li>
              ))}
          </ul>
        </div>
      ) : (
        // A fixed height with equal rows: the stage keeps its share of the
        // screen whether there are two people in it or eight.
        <ul
          className={cx(
            'grid auto-rows-fr gap-2',
            expanded ? 'min-h-0 flex-1' : 'h-52 lg:h-72',
            gridFor(tiles.length),
          )}
        >
          {tiles.map((tile) => (
            <li key={tile.key} className="min-h-0">
              {tile}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <p className="flex-1 truncate text-xs text-white/60">
          {call.status === 'joining'
            ? 'Joining'
            : `${String(tiles.length)} ${tiles.length === 1 ? 'person' : 'people'}`}
        </p>

        <Control
          icon={call.muted ? 'micOff' : 'mic'}
          label={call.muted ? 'Unmute' : 'Mute'}
          active={call.muted}
          onClick={onToggleMuted}
        />
        <Control
          icon={call.video ? 'video' : 'videoOff'}
          label={call.video ? 'Turn the camera off' : 'Turn the camera on'}
          active={!call.video}
          onClick={onToggleVideo}
        />
        <Control
          icon="screen"
          label={call.sharing ? 'Stop sharing' : 'Share your screen'}
          on={call.sharing}
          onClick={onToggleSharing}
          // Only Chromium hands a tab or a window to a page on a phone.
          className="hidden sm:grid"
        />
        <Control
          icon={expanded ? 'collapse' : 'expand'}
          label={expanded ? 'Shrink the huddle' : 'Expand the huddle'}
          on={expanded}
          onClick={() => setExpanded((open) => !open)}
        />
        <CallSettings session={session} call={call} layout={layout} onLayout={setLayout} />
        <Control icon="hangUp" label="Leave the huddle" danger onClick={onLeave} />
      </div>
    </section>
  );
}

interface ControlProps {
  icon: IconName;
  label: string;
  /** The state people check at a glance: off, and therefore highlighted. */
  active?: boolean;
  on?: boolean;
  danger?: boolean;
  className?: string;
  onClick(): void;
}

function Control({ icon, label, active, on, danger, className, onClick }: ControlProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on ?? active ?? false}
      title={label}
      className={cx(
        'grid size-11 shrink-0 place-items-center rounded-full motion-safe:transition-colors',
        className,
        danger
          ? 'bg-critical text-white hover:brightness-110'
          : on
            ? 'bg-accent text-white'
            : active
              ? 'bg-white text-neutral-900'
              : 'bg-white/10 text-white hover:bg-white/20',
      )}
    >
      <Icon name={icon} className="size-5" />
    </button>
  );
}

interface Stage {
  stream: MediaStream | null;
  name: string;
  /** A screen is letterboxed. A face fills the frame. */
  contain: boolean;
  self: boolean;
}

function screenOf(peers: PeerView[], members: MemberProfile[]): Stage | null {
  const sharing = peers.find((peer) => peer.sharing && peer.screen);
  if (!sharing) return null;

  const member = members.find((one) => one.id === sharing.userId);
  return {
    stream: sharing.screen,
    name: `${member?.displayName ?? 'Someone'} is sharing`,
    contain: true,
    self: false,
  };
}

/** The tile somebody pinned, which beats whatever the room would have chosen. */
function focusedTile(
  focus: string,
  call: CallView,
  members: MemberProfile[],
  me: MemberProfile | undefined,
): Stage {
  if (focus === 'self') {
    return {
      stream: call.sharing ? call.screen : call.camera,
      name: call.sharing ? 'Your screen' : (me?.displayName ?? 'You'),
      contain: call.sharing,
      self: true,
    };
  }

  const peer = call.peers.find((one) => one.sessionId === focus);
  const member = members.find((one) => one.id === peer?.userId);
  const showingScreen = Boolean(peer?.sharing && peer.screen);

  return {
    stream: showingScreen ? (peer?.screen ?? null) : (peer?.camera ?? null),
    name: member?.displayName ?? 'Someone',
    contain: showingScreen,
    self: false,
  };
}

/** Squarer as the room grows, so nobody ends up a letterbox. */
function gridFor(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-2 sm:grid-cols-3';
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
}

/** Who to put on the stage when nothing is shared and nothing is pinned. */
function loudestTile(
  call: CallView,
  members: MemberProfile[],
  me: MemberProfile | undefined,
): Stage {
  const speaking = call.peers.find((peer) => peer.speaking) ?? call.peers[0];
  if (!speaking) {
    return { stream: call.camera, name: me?.displayName ?? 'You', contain: false, self: true };
  }

  const member = members.find((one) => one.id === speaking.userId);
  return {
    stream: speaking.camera,
    name: member?.displayName ?? 'Someone',
    contain: false,
    self: false,
  };
}
