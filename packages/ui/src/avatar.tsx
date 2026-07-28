import { cx } from './cx.js';

export interface AvatarProps {
  name: string;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'size-6 text-2xs',
  md: 'size-8 text-xs',
  lg: 'size-11 text-sm',
} as const;

/**
 * Tinted from the name so people stay visually distinct in a list without
 * anyone having to upload a picture. Hue only, so contrast stays fixed.
 */
export function Avatar({ name, url, size = 'md', className }: AvatarProps) {
  const hue = hueFrom(name);

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cx('shrink-0 rounded-lg object-cover', SIZES[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-lg font-semibold',
        SIZES[size],
        className,
      )}
      style={{
        backgroundColor: `oklch(0.88 0.06 ${hue})`,
        color: `oklch(0.38 0.09 ${hue})`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('') || '?';
}

function hueFrom(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 360;
  return hash;
}
