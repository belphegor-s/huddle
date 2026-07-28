import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Switzer is not on npm, so it is pulled from Fontshare and committed as woff2.
 *
 * The files are vendored rather than linked because the app must make no third
 * party requests at runtime. Bricolage Grotesque and Commit Mono come from
 * their fontsource packages and need no fetching.
 *
 * Switzer is licensed under the ITF Free Font License, which permits
 * commercial use and self hosting.
 */

const OUT_DIR = fileURLToPath(new URL('../packages/ui/fonts', import.meta.url));
const WEIGHTS = [400, 500, 600, 700];
const CSS_URL = `https://api.fontshare.com/v2/css?f%5B%5D=switzer@${WEIGHTS.join(',')}`;

const css = await fetch(CSS_URL, { headers: { 'user-agent': 'Mozilla/5.0' } }).then((r) => {
  if (!r.ok) throw new Error(`Fontshare returned ${r.status}`);
  return r.text();
});

const blocks = css.split('@font-face').slice(1);
await mkdir(OUT_DIR, { recursive: true });

let written = 0;
for (const block of blocks) {
  const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
  const url = /url\('(\/\/[^']+\.woff2)'\)/.exec(block)?.[1];
  if (!weight || !url) continue;

  const bytes = await fetch(`https:${url}`).then((r) => {
    if (!r.ok) throw new Error(`Font download failed with ${r.status}`);
    return r.arrayBuffer();
  });

  const name = `switzer-${weight}.woff2`;
  await writeFile(new URL(`file://${OUT_DIR.replace(/\\/g, '/')}/${name}`), Buffer.from(bytes));
  console.log(`${name} ${(bytes.byteLength / 1024).toFixed(1)}kb`);
  written += 1;
}

if (written !== WEIGHTS.length) {
  throw new Error(`Expected ${WEIGHTS.length} fonts, wrote ${written}`);
}
