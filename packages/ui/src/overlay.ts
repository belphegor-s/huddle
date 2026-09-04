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
 */
export function place(
  element: HTMLElement,
  trigger: HTMLElement | null,
  align: Align,
  side: Side,
): void {
  if (!trigger) return;

  const anchor = trigger.getBoundingClientRect();
  const panel = element.getBoundingClientRect();

  const below = window.innerHeight - anchor.bottom - GAP;
  const above = anchor.top - GAP;
  const goesUp =
    side === 'top' ? above > panel.height || above > below : below < panel.height && above > below;

  const top = goesUp ? anchor.top - panel.height - GAP : anchor.bottom + GAP;
  const wanted = align === 'end' ? anchor.right - panel.width : anchor.left;

  const left = Math.min(Math.max(MARGIN, wanted), window.innerWidth - panel.width - MARGIN);
  const clamped = Math.min(Math.max(MARGIN, top), window.innerHeight - panel.height - MARGIN);

  element.style.left = `${String(Math.round(left))}px`;
  element.style.top = `${String(Math.round(clamped))}px`;
}
