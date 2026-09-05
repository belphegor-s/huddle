import type { MemberProfile } from '@huddle/core';
import { cx, Icon, type IconName } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CallSession, CallView, PeerView } from '../lib/call';
import { CallSettings, type CallLayout } from './call-settings';
import { CallTile } from './call-tile';

/** Where the call is drawn. Fullscreen is a fourth state the stage owns. */
export type CallPlacement = 'panel' | 'docked';

interface CallStageProps {
  session: CallSession;
  call: CallView;
  members: MemberProfile[];
  meId: string;
  placement: CallPlacement;
  /** Where the conversation is, for the way back out of the corner. */
  channelPath: string;
  onDock(): void;
  onOpen(): void;
  onToggleMuted(): void;
  onToggleVideo(): void;
  onToggleSharing(): void;
  onLeave(): void;
}

/**
 * The call takes the panel, not a slice of it.
 *
 * A split, with the call above and the messages squeezed below, gave neither
 * enough room: a shared screen was unreadable and the conversation was three
 * lines tall. So a huddle covers the conversation it belongs to, and the way
 * to keep reading is to put it in the corner, which is a decision rather than
 * a side effect of the window being short.
 *
 * Three placements. Over the panel, which is the default. In the corner, which
 * is where it goes when it is collapsed or when you walk to another channel.
 * And fullscreen, asked for properly, with the call still filling the window
 * if the browser refuses so the control never does nothing.
 */
export function CallStage({
  session,
  call,
  members,
  meId,
  placement,
  channelPath,
  onDock,
  onOpen,
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

  const docked = placement === 'docked' && !expanded;

  return (
    <section
      ref={setStage}
      aria-label="Huddle"
      className={cx(
        'flex flex-col gap-2 bg-neutral-950 text-white',
        expanded
          ? 'fixed inset-0 z-50 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]'
          : docked
            ? // Clear of the composer and of a phone's home indicator.
              'shadow-sheet fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 w-72 overflow-hidden rounded-xl border border-white/10 p-1.5'
            : 'absolute inset-0 z-30 p-2',
      )}
    >
      {docked ? (
        <Link
          to={channelPath}
          onClick={onOpen}
          className="flex min-h-8 items-center gap-1.5 px-1 text-xs font-medium text-white/80 no-underline hover:text-white"
        >
          <span className="bg-positive size-1.5 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1 truncate">{call.channelName}</span>
          <Icon name="expand" className="size-3.5 shrink-0" />
        </Link>
      ) : null}

      {shared ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden lg:flex-row">
          <div className="min-h-0 flex-1">
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
          <ul
            className={cx(
              'flex shrink-0 gap-2 overflow-x-auto lg:w-40 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto',
              docked && 'hidden',
            )}
          >
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
        <ul className={cx('grid min-h-0 flex-1 auto-rows-fr gap-2', gridFor(tiles.length))}>
          {tiles.map((tile) => (
            <li key={tile.key} className="min-h-0">
              {tile}
            </li>
          ))}
        </ul>
      )}

      {/*
        Wrapped rather than squeezed. Seven controls at the size a thumb needs
        is wider than a phone, and a row that overflows takes the way out of
        the call with it.
      */}
      <div
        className={cx(
          'flex shrink-0 flex-wrap items-center justify-center gap-1.5',
          docked ? '' : 'pt-1',
        )}
      >
        {docked ? null : (
          <p className="min-w-0 flex-1 truncate text-xs text-white/60">
            {call.status === 'joining'
              ? 'Joining'
              : `${String(tiles.length)} ${tiles.length === 1 ? 'person' : 'people'}`}
          </p>
        )}

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

        {docked ? null : (
          <>
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
              label={expanded ? 'Leave full screen' : 'Full screen'}
              on={expanded}
              onClick={() => setExpanded((open) => !open)}
            />
            {/*
              Out of the way rather than gone: the call keeps running in the
              corner and the conversation underneath becomes readable again.
            */}
            <Control
              icon="minus"
              label="Put the huddle in the corner"
              onClick={() => {
                setExpanded(false);
                onDock();
              }}
            />
            <CallSettings session={session} call={call} layout={layout} onLayout={setLayout} />
          </>
        )}

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
