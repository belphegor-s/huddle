import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  for (let i = 0; i < 40; i++) {
    const lines = readFileSync(SERVER_LOG, 'utf8')
      .split('\n')
      .filter((l) => l.includes('email_not_sent') && l.includes(email));
    const last = lines.at(-1);
    if (last) {
      const parsed = JSON.parse(last.slice(last.indexOf('{'))) as { text: string };
      const found = /https?:\/\/\S+/.exec(parsed.text)?.[0];
      if (found) {
        await page.goto(found);
        return;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error('no link');
}

test('a shared screen reaches the other end', async ({ browser }) => {
  const slug = `share${Date.now().toString(36)}`;
  const owner = await browser.newContext();
  const a = await owner.newPage();
  await signIn(a, `owner-${slug}@example.com`);
  await a.getByLabel('Team name').fill('Sharers');
  await a.getByLabel('Address').fill(slug);
  await a.getByRole('button', { name: 'Create workspace' }).click();
  await a.getByRole('button', { name: 'New channel' }).click();
  await a.getByLabel('Name').fill('general');
  await a.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(a).toHaveURL(/\/c\/general$/);

  await a.goto(`/w/${slug}/people`);
  await a.getByRole('button', { name: 'New link' }).click();
  const invite = new URL((await a.locator('output').first().textContent()) ?? '').pathname;

  const guest = await browser.newContext();
  const b = await guest.newPage();
  await signIn(b, `guest-${slug}@example.com`);
  await b.goto(invite);
  await b.getByRole('button', { name: 'Join workspace' }).click();
  await expect(b).toHaveURL(new RegExp(`/w/${slug}$`));
  await b.goto(`/w/${slug}/c/general`);

  await a.goto(`/w/${slug}/c/general`);
  await a.getByRole('button', { name: 'Huddle' }).click();
  await expect(b.getByRole('button', { name: 'Join (1)' })).toBeVisible({ timeout: 15000 });
  await b.getByRole('button', { name: 'Join (1)' }).click();
  await expect(a.getByRole('region', { name: 'Huddle' }).getByText('2 people')).toBeVisible({
    timeout: 15000,
  });
  await expect(b.getByRole('region', { name: 'Huddle' }).getByText('Connecting')).toHaveCount(0, {
    timeout: 30000,
  });

  await a.getByRole('button', { name: 'Share your screen' }).click();
  await expect(b.getByText('is sharing')).toBeVisible({ timeout: 20000 });

  await b
    .waitForFunction(
      () => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0),
      undefined,
      { timeout: 20000 },
    )
    .catch(() => console.log('NO_FRAMES'));

  const shared = await b.evaluate(() =>
    [...document.querySelectorAll('video')].map((v) => {
      const s = v.srcObject as MediaStream | null;
      return { width: v.videoWidth, tracks: s ? s.getTracks().length : 0 };
    }),
  );

  expect(shared).toContainEqual(expect.objectContaining({ tracks: 1 }));
  expect(shared.every((one) => one.width > 0)).toBe(true);

  // Stopping puts everybody back in the grid rather than leaving a dead pane.
  await a.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(b.getByText('is sharing')).toHaveCount(0, { timeout: 15_000 });

  await guest.close();
  await owner.close();
});
