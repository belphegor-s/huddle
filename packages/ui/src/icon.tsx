import { cx } from './cx.js';

/**
 * One inline SVG sprite compiled into the bundle. Not an icon package and not
 * a font: an icon library is a dependency that ships hundreds of glyphs to
 * draw twenty, and an icon font fetched from anywhere is a third party request
 * the privacy rule forbids.
 *
 * Every path is drawn on a 24 unit grid with a 1.75 stroke and round caps, so
 * the whole set has one weight and sits on the same optical baseline as the
 * text beside it.
 */
const PATHS = {
  attach:
    'M15.8 6.55 8.6 13.75a2.2 2.2 0 0 0 3.1 3.1l7.2-7.2a4 4 0 0 0-5.7-5.7L5.5 11.65a5.9 5.9 0 0 0 8.3 8.3l6.6-6.6',
  send: 'M4 11.5 20.5 4l-7.5 16.5-2.2-6.8L4 11.5Z',
  mic: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  play: 'M6.2 4.6 17.8 12 6.2 19.4Z',
  pause: 'M9 5v14M15 5v14',
  stop: 'M6.5 6.5h11v11h-11z',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  hash: 'M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h15M3.5 15h15',
  lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M6 10.5h12v9.5H6v-9.5Z',
  search: 'M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM15.8 15.8 20 20',
  chevronDown: 'm6.5 9.5 5.5 5.5 5.5-5.5',
  chevronLeft: 'm14.5 6.5-5.5 5.5 5.5 5.5',
  emoji:
    'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM8.75 14.5a4 4 0 0 0 6.5 0M9.25 9.5v.5M14.75 9.5v.5',
  reply: 'M9 5.5 3.5 11 9 16.5M3.5 11h9.5a7 7 0 0 1 7 7v1',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7',
  edit: 'M4.5 19.5h4L20 8a2.5 2.5 0 0 0-3.5-3.5L5 16v3.5ZM14.5 6 18 9.5',
  check: 'm5 12.5 4.5 4.5L19 7',
  bell: 'M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10ZM10 19a2 2 0 0 0 4 0',
  image: 'M4.5 5h15v14h-15zM4.5 15.5 9 11l4 4 2.5-2.5 3.5 3.5M15 8.75v.5',
  file: 'M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5l-5-5ZM13.5 3.5v5h5',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15',
  copy: 'M9 9V5.5h10.5V16H16M4.5 9H15v10.5H4.5V9Z',
  more: 'M7.4 12a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0ZM13.4 12a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0ZM19.4 12a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z',
  people:
    'M9 11.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  link: 'M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.6 1.6M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.6-1.6',
  thread: 'M4.5 5.5h15v10h-9l-6 4v-14Z',
  sparkle:
    'M9.8 2.8l1.9 5.2 5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2-5.2-1.9 5.2-1.9 1.9-5.2ZM18 14.2l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9.9-2.5Z',
} as const;

/**
 * Drawn as shapes rather than as strokes. A dot made from a zero length line
 * with a round cap antialiases into a smudge with a soft edge, which is why
 * the overflow control looked blurred against every other icon.
 */
const FILLED = new Set<string>(['more', 'play']);

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  className?: string;
  /** Set when the icon is the only content of a control. */
  label?: string;
}

export function Icon({ name, className, label }: IconProps) {
  const filled = FILLED.has(name);

  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Scales with the text it sits beside rather than being pinned to a
      // pixel size, so an icon in a small label stays proportionate.
      className={cx('size-[1.25em] shrink-0', className)}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Filled variants, for the two controls where an outline reads as inactive. */
export function IconSolid({ name, className, label }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      className={cx('size-[1.25em] shrink-0', className)}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
