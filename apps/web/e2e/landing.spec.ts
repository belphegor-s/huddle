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

test('the source link points at the repository', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Source' })).toHaveAttribute(
    'href',
    'https://github.com/belphegor-s/huddle',
  );
});
