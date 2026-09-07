import bricolage from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url';
import fraunces from '../fonts/fraunces-italic-500.woff2?url';
import switzer400 from '../fonts/switzer-400.woff2?url';
import switzer500 from '../fonts/switzer-500.woff2?url';
import switzer600 from '../fonts/switzer-600.woff2?url';

/**
 * The faces that set text a visitor sees before they scroll, in the order they
 * cover the most of it.
 *
 * A browser only asks for a font once something on screen is set in it, and
 * this client renders in the browser, so without these the request does not
 * start until React has painted. Text lands in the fallback face and then
 * reflows into the real one, which is the flicker these prevent: the bytes are
 * requested while the HTML is still parsing, in parallel with the script that
 * will need them.
 *
 * Only the latin subsets are here. The extended and Vietnamese cuts are
 * declared in the stylesheet and fetched if a page actually uses them, which
 * is what a preload must never guess at.
 */
export const fontPreloads: readonly string[] = [
  switzer400,
  bricolage,
  switzer500,
  switzer600,
  fraunces,
];
