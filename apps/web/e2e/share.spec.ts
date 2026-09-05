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
  await a.getByRole('button', { name: 'Start a huddle' }).click();
  await expect(b.getByRole('button', { name: 'Join the huddle, 1 in it' })).toBeVisible({
    timeout: 15000,
  });
  await b.getByRole('button', { name: 'Join the huddle, 1 in it' }).click();
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

  /*
   * Sound keeps flowing through all of it. The voice travels on the camera
   * stream, and the receiving end used to work out which arriving stream was
   * which by elimination: a share that stopped left a dead stream behind that
   * was then taken for the camera, and the room went silent for good.
   */
  const hears = async (page: Page): Promise<boolean> => {
    const before = await page.evaluate(() =>
      [...document.querySelectorAll('audio')].map((element) => ({
        at: element.currentTime,
        live: ((element.srcObject as MediaStream | null)?.getAudioTracks() ?? []).some(
          (track) => track.readyState === 'live',
        ),
        paused: element.paused,
      })),
    );

    await page.waitForTimeout(1200);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll('audio')].map((element) => element.currentTime),
    );

    return before.some((one, index) => one.live && !one.paused && (after[index] ?? 0) > one.at);
  };

  expect(await hears(b), 'the other end went quiet while a screen was shared').toBe(true);

  // Stopping puts everybody back in the grid rather than leaving a dead pane.
  await a.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(b.getByText('is sharing')).toHaveCount(0, { timeout: 15_000 });

  await expect.poll(() => hears(b), { timeout: 20_000 }).toBe(true);

  // And the camera that was under the share is still the camera.
  const after = await b.evaluate(() =>
    [...document.querySelectorAll('video')].map((element) => element.videoWidth),
  );
  expect(after.every((width) => width > 0)).toBe(true);

  await guest.close();
  await owner.close();
});
