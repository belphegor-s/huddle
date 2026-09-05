import { cx } from './cx.js';

export type PresenceState = 'active' | 'away' | 'busy' | 'offline' | 'call';

export interface AvatarProps {
  name: string;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Drawn as a dot on the corner. Omit it entirely where presence is not the
   * point, rather than passing "offline", so a list of names does not turn
   * into a wall of grey dots.
   */
  presence?: PresenceState;
  className?: string;
}

const SIZES = {
  sm: 'size-6 text-2xs',
  md: 'size-8 text-xs',
  lg: 'size-11 text-sm',
  /* Large enough to judge a crop by, for the one place that shows your own. */
  xl: 'size-20 rounded-2xl text-xl',
} as const;

const DOT_SIZES = {
  sm: 'size-2 border',
  md: 'size-2.5 border-2',
  lg: 'size-3 border-2',
  xl: 'size-4 border-2',
} as const;

/*
 * Colour is not the only difference between these: away is hollow and busy
 * carries a bar, so they are still told apart without seeing colour.
 */
const DOTS: Record<PresenceState, string> = {
  active: 'bg-positive',
  away: 'bg-surface-raised border-caution ring-2 ring-inset ring-caution',
  busy: 'bg-critical',
  offline: 'bg-border-strong',
  call: 'bg-positive',
};

const LABELS: Record<PresenceState, string> = {
  active: 'Active',
  away: 'Away',
  busy: 'Do not disturb',
  offline: 'Offline',
  call: 'In a huddle',
};

/**
 * Tinted from the name so people stay visually distinct in a list without
 * anyone having to upload a picture. Hue only, so contrast stays fixed.
 */
export function Avatar({ name, url, size = 'md', presence, className }: AvatarProps) {
  const hue = hueFrom(name);

  const face = url ? (
    <img src={url} alt="" className={cx('shrink-0 rounded-lg object-cover', SIZES[size])} />
  ) : (
    <span
      aria-hidden
      className={cx('grid shrink-0 place-items-center rounded-lg font-semibold', SIZES[size])}
      style={{
        backgroundColor: `oklch(0.88 0.06 ${String(hue)})`,
        color: `oklch(0.38 0.09 ${String(hue)})`,
      }}
    >
      {initials(name)}
    </span>
  );

  if (!presence) return <span className={cx('contents', className)}>{face}</span>;

  return (
    <span className={cx('relative inline-flex shrink-0', className)}>
      {face}
      <span
        role="img"
        aria-label={LABELS[presence]}
        title={LABELS[presence]}
        className={cx(
          'border-surface-sunken absolute -right-0.5 -bottom-0.5 rounded-full',
          DOT_SIZES[size],
          DOTS[presence],
          // A huddle is the one state worth catching the eye, because it is the
          // only one you can join.
          presence === 'call' && 'motion-safe:animate-pulse',
        )}
      />
    </span>
  );
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('') || '?';
}

function hueFrom(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}
