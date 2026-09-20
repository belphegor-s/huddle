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

test('the hero gradient credits its open source', async ({ page }) => {
  await page.goto('/');

  // The credit carries the attribution in its title, which is the tooltip the
  // pointer gets, and the visible text stays short.
  const credit = page.getByRole('link', { name: 'Gradient: Paper Shaders' });
  await expect(credit).toBeVisible();
  await expect(credit).toHaveAttribute('href', 'https://shaders.paper.design');
  await expect(credit).toHaveAttribute('title', /Apache-2\.0/);
});
