import { expect, test } from '@playwright/test';

test('the hero conversation never changes height while it plays', async ({ page }) => {
  await page.goto('/');

  const panel = page.locator('ul').filter({ hasText: 'Where did we land' }).first();
  await expect(panel).toBeVisible();

  const heights = new Set<number>();
  for (let sample = 0; sample < 30; sample++) {
    const box = await panel.boundingBox();
    if (box) heights.add(Math.round(box.height));
    await page.waitForTimeout(250);
  }

  // The panel used to grow a line at a time, shoving the page down under it.
  expect([...heights]).toHaveLength(1);
});

test('every source link points at the repository', async ({ page }) => {
  await page.goto('/');

  // The header and the footer both carry one.
  const sources = page.getByRole('link', { name: 'Source' });
  await expect(sources.first()).toBeVisible();

  for (const link of await sources.all()) {
    await expect(link).toHaveAttribute('href', 'https://github.com/belphegor-s/huddle');
  }
});

test('the hero shader credits its open source only on hover and in the footer', async ({
  page,
}) => {
  await page.goto('/');

  // No visible credit in the hero: the backdrop carries it as its tooltip.
  const backdrop = page.locator('section div[title*="webgl-noise"]').first();
  await expect(backdrop).toHaveAttribute('title', /MIT/);

  const credit = page.locator('footer').getByRole('link', { name: 'webgl-noise' });
  await expect(credit).toBeVisible();
  await expect(credit).toHaveAttribute('href', 'https://github.com/stegu/webgl-noise');
  await expect(credit).toHaveAttribute('title', /MIT/);
});
