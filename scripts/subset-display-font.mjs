import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

/**
 * Fraunces sets two emphasised phrases on the landing page and nothing else,
 * so shipping the family as published means sending a variable font with a
 * full weight axis and several hundred glyphs to set about thirty characters.
 *
 * This cuts it to the printable ASCII range plus the quotes and the ellipsis,
 * at the one weight the page asks for, which takes it from 45kb to 15kb. That
 * matters because the face is preloaded: bytes requested before the first
 * paint are bytes competing with the script that draws the page.
 *
 * The result is committed the same way Switzer is, so a build needs neither
 * this script nor the package it reads from.
 *
 * Run it again if the emphasised copy ever needs a character outside that set.
 */

const SOURCE = fileURLToPath(
  new URL(
    '../packages/ui/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2',
    import.meta.url,
  ),
);
const OUT = fileURLToPath(
  new URL('../packages/ui/fonts/fraunces-italic-500.woff2', import.meta.url),
);

const WEIGHT = 500;
const CHARS = [
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(0x20 + i)),
  '\u2018',
  '\u2019',
  '\u201c',
  '\u201d',
  '\u2026',
].join('');

const source = await readFile(SOURCE);
const subset = await subsetFont(source, CHARS, {
  targetFormat: 'woff2',
  variationAxes: { wght: { min: WEIGHT, max: WEIGHT, default: WEIGHT } },
});

await writeFile(OUT, subset);
console.log(
  `fraunces-italic-${String(WEIGHT)}.woff2 ${(subset.length / 1024).toFixed(1)}kb ` +
    `from ${(source.length / 1024).toFixed(1)}kb`,
);
