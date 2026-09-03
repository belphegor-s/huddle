import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Every glyph has to sit inside its own box and be centred in it.
 *
 * A path that runs past the viewBox is clipped, which is how the paperclip came
 * to be missing its bottom edge, and one that is centred badly reads as a
 * wobble in a row of buttons. Neither is visible in the source: the numbers are
 * only wrong once the browser has drawn them, which is why this is measured
 * rather than reviewed.
 */
const STROKE = 1.75;
const FILLED = new Set(['more', 'play']);

/** Half a unit of slack, well under what an eye can see at 20 pixels. */
const CENTRE_TOLERANCE = 0.6;

test('every icon fits its box and is centred', async ({ page }) => {
  const source = readFileSync('../../packages/ui/src/icon.tsx', 'utf8');
  const block = source.slice(source.indexOf('const PATHS = {'), source.indexOf('} as const;'));

  const paths: Record<string, string> = {};
  for (const match of block.matchAll(/(\w+):\s*\n?\s*'([^']+)'/g)) {
    paths[match[1] ?? ''] = match[2] ?? '';
  }

  expect(Object.keys(paths).length).toBeGreaterThan(10);
  await page.setContent('<svg viewBox="0 0 24 24"><path id="p"/></svg>');

  const problems: string[] = [];

  for (const [name, d] of Object.entries(paths)) {
    const box = await page.evaluate((value) => {
      const path = document.getElementById('p') as unknown as SVGPathElement;
      path.setAttribute('d', value);
      const measured = path.getBBox();
      return { x: measured.x, y: measured.y, w: measured.width, h: measured.height };
    }, d);

    // A stroke straddles the path, so half of it lies outside the geometry.
    const pad = FILLED.has(name) ? 0 : STROKE / 2;
    const left = box.x - pad;
    const top = box.y - pad;
    const right = box.x + box.w + pad;
    const bottom = box.y + box.h + pad;

    if (left < 0 || top < 0 || right > 24 || bottom > 24) {
      problems.push(
        `${name} is clipped: ${left.toFixed(2)},${top.toFixed(2)} to ${right.toFixed(2)},${bottom.toFixed(2)}`,
      );
    }

    const offX = (left + right) / 2 - 12;
    const offY = (top + bottom) / 2 - 12;
    if (Math.abs(offX) > CENTRE_TOLERANCE || Math.abs(offY) > CENTRE_TOLERANCE) {
      problems.push(`${name} is off centre by ${offX.toFixed(2)},${offY.toFixed(2)}`);
    }
  }

  expect(problems, problems.join('\n')).toEqual([]);
});
