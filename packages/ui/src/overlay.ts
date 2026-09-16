/**
 * The machinery every floating panel in the app shares.
 *
 * Panels render into the browser's top layer through the popover attribute,
 * which is the only reliable answer to being covered: a stacking context
 * created by a transform or an overflow anywhere up the tree beats any
 * z-index that can be written, and replying with a bigger number never ends.
 * The top layer sits outside the page's stacking contexts entirely, so a menu
 * inside a scrolling message list is not clipped by it either.
 *
 * Light dismiss, Escape, and closing when another panel opens all come from
 * the platform. Placement does not, outside Chromium, so it is done here.
 */

export const POPOVER_SUPPORTED =
  typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');

/** Distance from the control, so the panel reads as attached to it. */
const GAP = 6;

/** Never let a panel touch the edge of the window. */
const MARGIN = 8;

export type Align = 'start' | 'end';
export type Side = 'bottom' | 'top';

/**
 * Places a panel against its control, flipping and sliding rather than hanging
 * off the edge of the window.
 *
 * Size is read from the element's own layout box rather than its bounding
 * rectangle, because a panel that is still animating in carries a transform
 * that would otherwise be measured and placed against. The real side is
 * returned so the caller can start it sliding from the trigger it came off.
 */
export function place(
  element: HTMLElement,
  trigger: HTMLElement | null,
  align: Align,
  side: Side,
): Side {
  if (!trigger) return side;

  const anchor = trigger.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;

  const below = window.innerHeight - anchor.bottom - GAP;
  const above = anchor.top - GAP;
  const goesUp = side === 'top' ? above > height || above > below : below < height && above > below;

  const top = goesUp ? anchor.top - height - GAP : anchor.bottom + GAP;
  const wanted = align === 'end' ? anchor.right - width : anchor.left;

  const left = Math.min(Math.max(MARGIN, wanted), window.innerWidth - width - MARGIN);
  const clamped = Math.min(Math.max(MARGIN, top), window.innerHeight - height - MARGIN);

  element.style.left = `${String(Math.round(left))}px`;
  element.style.top = `${String(Math.round(clamped))}px`;

  return goesUp ? 'top' : 'bottom';
}

/**
 * Points the entrance the right way: a panel below its control drops down from
 * it, one above rises up to it. Motion reads as the panel coming from the
 * thing that opened it rather than fading in from nowhere.
 *
 * Called twice around opening: once with the preferred side before the popover
 * is shown, because the starting style is read at that instant, and once with
 * the side placement actually chose.
 */
export function aim(element: HTMLElement, from: Side): void {
  element.style.setProperty('--panel-from-y', from === 'top' ? '6px' : '-6px');
}
