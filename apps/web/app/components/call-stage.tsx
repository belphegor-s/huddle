import type { MemberProfile } from '@huddle/core';
import { cx, Icon, type IconName } from '@huddle/ui';
import type { CallView, PeerView } from '../lib/call';
import { CallTile } from './call-tile';

interface CallStageProps {
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
 */
export function CallStage({
  call,
  members,
  meId,
  onToggleMuted,
  onToggleVideo,
  onToggleSharing,
  onLeave,
}: CallStageProps) {
  const me = members.find((member) => member.id === meId);
  const shared = call.sharing
    ? { stream: call.screen, name: 'Your screen' }
    : screenOf(call.peers, members);

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
        />
      );
    }),
  ];

  return (
    <section
      aria-label="Huddle"
      className="border-border flex shrink-0 flex-col gap-2 border-b bg-neutral-950 p-2 text-white"
    >
      {shared ? (
        <div className="flex min-h-0 flex-col gap-2 lg:flex-row">
          <div className="min-h-48 flex-1 lg:min-h-64">
            <CallTile
              contain
              name={shared.name}
              avatarUrl={null}
              stream={shared.stream}
              video
              muted={false}
              speaking={false}
              self={call.sharing}
            />
          </div>

          {/* A strip rather than the grid, so the screen keeps the room. */}
          <ul className="flex gap-2 overflow-x-auto lg:w-40 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto">
            {tiles.map((tile, index) => (
              <li key={index} className="aspect-video w-28 shrink-0 lg:w-full">
                {tile}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // A fixed height with equal rows: the stage keeps its share of the
        // screen whether there are two people in it or eight.
        <ul className={cx('grid h-52 auto-rows-fr gap-2 lg:h-72', gridFor(tiles.length))}>
          {tiles.map((tile, index) => (
            <li key={index} className="min-h-0">
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

function screenOf(
  peers: PeerView[],
  members: MemberProfile[],
): { stream: MediaStream | null; name: string } | null {
  const sharing = peers.find((peer) => peer.sharing && peer.screen);
  if (!sharing) return null;

  const member = members.find((one) => one.id === sharing.userId);
  return { stream: sharing.screen, name: `${member?.displayName ?? 'Someone'} is sharing` };
}

/** Squarer as the room grows, so nobody ends up a letterbox. */
function gridFor(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-2 sm:grid-cols-3';
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
}
