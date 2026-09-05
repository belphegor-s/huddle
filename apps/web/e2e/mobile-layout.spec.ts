import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * Every screen, on a phone, checked for the two faults that make an app feel
 * broken there: something wider than the window, and a field small enough that
 * iOS zooms the page when it takes focus.
 *
 * Both are measured rather than looked at. A screenshot review misses a two
 * pixel overflow, and the font size threshold is a platform rule with a
 * number, so it can simply be asserted.
 *
 * A phone viewport on chromium rather than a device preset, which would pull
 * in webkit for no extra coverage here: a width is a width, and the font size
 * threshold is a number that can be checked anywhere.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  for (let attempt = 0; attempt < 40; attempt++) {
    const lines = readFileSync(SERVER_LOG, 'utf8')
      .split('\n')
      .filter((line) => line.includes('email_not_sent') && line.includes(email));

    const last = lines.at(-1);
    if (last !== undefined) {
      const parsed = JSON.parse(last.slice(last.indexOf('{'))) as { text: string };
      const found = /https?:\/\/\S+/.exec(parsed.text)?.[0];
      if (found) {
        await page.goto(found);
        return;
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error('No sign in link was written');
}

/** Anything sticking out past the window, named so a failure is actionable. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;

    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;

        // A pixel of rounding is not a layout fault.
        return box.right > limit + 1 || box.left < -1;
      })
      .slice(0, 5)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const name = element.tagName.toLowerCase();
        const classes = element.className.toString().slice(0, 60);
        return `${name}.${classes} [${String(Math.round(box.left))}..${String(Math.round(box.right))}] of ${String(limit)}`;
      });
  });
}

test('no screen is wider than the phone it is on', async ({ page }) => {
  const slug = `m${Date.now().toString(36)}`;
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Mobile');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('general');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/general$/);

  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('a message long enough to test how a phone wraps a paragraph of text');
  // Enter is a newline on a touch keyboard, by design. The button is the way.
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByRole('list', { name: 'Messages' }).getByText('a message long enough'),
  ).toBeVisible();

  /*
   * The detector, checked against a fault put there on purpose. A test that
   * only ever passes proves nothing, and this one would pass just as happily
   * if the query were wrong.
   */
  await page.evaluate(() => {
    const wide = document.createElement('div');
    wide.id = 'deliberately-too-wide';
    wide.style.cssText = 'position:fixed;top:0;left:0;width:120vw;height:8px';
    document.body.append(wide);
  });
  expect(await overflowing(page)).not.toEqual([]);
  await page.evaluate(() => document.querySelector('#deliberately-too-wide')?.remove());
  expect(await overflowing(page)).toEqual([]);

  for (const path of [
    '/',
    '/signin',
    `/w/${slug}`,
    `/w/${slug}/c/general`,
    `/w/${slug}/people`,
    `/w/${slug}/you`,
    `/w/${slug}/settings`,
    `/w/${slug}/search`,
  ]) {
    await page.goto(path);
    await page.waitForTimeout(500);

    const wide = await overflowing(page);
    expect(wide, `${path} has something wider than the window`).toEqual([]);

    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrolls, `${path} scrolls sideways`).toBe(false);
  }
});

test('no field is small enough to make iOS zoom the page', async ({ page }) => {
  const slug = `z${Date.now().toString(36)}`;
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Zoom');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('general');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/general$/);

  for (const path of ['/signin', `/w/${slug}/c/general`, `/w/${slug}/you`, `/w/${slug}/search`]) {
    await page.goto(path);
    await page.waitForTimeout(400);

    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('input, textarea, select')]
        .filter((element) => {
          if (element.type === 'hidden' || element.type === 'file') return false;
          if (element.closest('[hidden]')) return false;

          // Sixteen is the threshold Safari zooms below. Not fifteen.
          return Number.parseFloat(getComputedStyle(element).fontSize) < 16;
        })
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}[${element.getAttribute('aria-label') ?? element.type}] at ${getComputedStyle(element).fontSize}`,
        ),
    );

    expect(small, `${path} has a field iOS will zoom into`).toEqual([]);
  }
});
