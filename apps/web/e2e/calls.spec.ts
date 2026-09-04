import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * Two real browsers, a real signalling socket and a real peer connection.
 *
 * Nothing below the socket can be tested any other way: the roster, the offer
 * and answer, and the moment the two ends actually reach each other all happen
 * outside the server, so a passing unit test proves only that the relay was
 * willing to forward bytes.
 */

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

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test('two people huddle, see each other and hang up', async ({ browser }) => {
  const slug = unique('huddle');

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, `owner-${slug}@example.com`);

  // Not named after the feature: the workspace switcher would then be a
  // second control with the same accessible name as the huddle button.
  await ownerPage.getByLabel('Team name').fill('Callers');
  await ownerPage.getByLabel('Address').fill(slug);
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/w/${slug}$`));

  await ownerPage.getByRole('button', { name: 'New channel' }).click();
  await ownerPage.getByLabel('Name').fill('general');
  await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(ownerPage).toHaveURL(/\/c\/general$/);

  await ownerPage.goto(`/w/${slug}/people`);
  await ownerPage.getByRole('button', { name: 'New link' }).click();
  const invite = new URL((await ownerPage.locator('output').first().textContent()) ?? '').pathname;

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await signIn(guestPage, `guest-${slug}@example.com`);
  await guestPage.goto(invite);
  await guestPage.getByRole('button', { name: 'Join workspace' }).click();
  // Joining has to have landed before navigating, or the next page load races
  // the membership and the workspace reads as one this person is not in.
  await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}$`));
  await guestPage.goto(`/w/${slug}/c/general`);

  await ownerPage.goto(`/w/${slug}/c/general`);
  await ownerPage.getByRole('button', { name: 'Huddle', exact: true }).click();

  const ownerStage = ownerPage.getByRole('region', { name: 'Huddle' });
  await expect(ownerStage).toBeVisible();
  await expect(ownerStage.getByText('1 person')).toBeVisible();

  // The guest is told about the call without being in it or reloading.
  const join = guestPage.getByRole('button', { name: 'Join (1)' });
  await expect(join).toBeVisible({ timeout: 10_000 });
  await join.click();

  const guestStage = guestPage.getByRole('region', { name: 'Huddle' });
  await expect(guestStage).toBeVisible();
  await expect(guestStage.getByText('2 people')).toBeVisible({ timeout: 10_000 });
  await expect(ownerStage.getByText('2 people')).toBeVisible({ timeout: 10_000 });

  // The overlay is driven by the connection state itself, so it going away is
  // the two browsers having actually reached each other.
  await expect(guestStage.getByText('Connecting')).toHaveCount(0, { timeout: 30_000 });
  await expect(ownerStage.getByText('Connecting')).toHaveCount(0, { timeout: 30_000 });

  // Sound has to work with every camera off, which is how a huddle usually
  // runs. The tile used to double as the speaker, so with no video there was
  // no element holding the stream and the room was silent until somebody
  // turned a camera on.
  const heard = async (page: Page) => {
    const first = await page.evaluate(() =>
      [...document.querySelectorAll('audio')].map((el) => {
        const stream = el.srcObject as MediaStream | null;
        return {
          tracks: stream
            ? stream.getAudioTracks().filter((t) => t.readyState === 'live').length
            : 0,
          paused: el.paused,
          at: el.currentTime,
        };
      }),
    );

    await page.waitForTimeout(1200);

    const second = await page.evaluate(() =>
      [...document.querySelectorAll('audio')].map((el) => el.currentTime),
    );

    return first.map((one, index) => ({ ...one, advanced: (second[index] ?? 0) > one.at }));
  };

  for (const page of [ownerPage, guestPage]) {
    const players = await heard(page);
    expect(players.length).toBeGreaterThan(0);
    expect(players.some((one) => one.tracks > 0 && !one.paused && one.advanced)).toBe(true);
  }

  // Expanded, the call takes the screen rather than a strip of it.
  const strip = (await ownerStage.boundingBox())?.height ?? 0;
  await ownerPage.getByRole('button', { name: 'Expand the huddle' }).click();

  const full = (await ownerStage.boundingBox())?.height ?? 0;
  expect(full).toBeGreaterThan(strip * 1.5);
  await expect(ownerStage.getByText('2 people')).toBeVisible();

  // Back through the control rather than Escape: once the browser has granted
  // real fullscreen, Escape belongs to the browser, and the visible way out is
  // the one that has to work.
  await ownerPage.getByRole('button', { name: 'Shrink the huddle' }).click();
  await expect(ownerPage.getByRole('button', { name: 'Expand the huddle' })).toBeVisible();
  // Leaving fullscreen resizes the window, which the layout follows a frame
  // or two later.
  await expect.poll(async () => (await ownerStage.boundingBox())?.height ?? 0).toBeLessThan(full);
  await expect(ownerPage.getByLabel('Message', { exact: true })).toBeVisible();

  // Mute travels over the roster rather than over the media, so it is visible
  // to the other end even though nothing about the stream changed.
  await ownerPage.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(guestStage.getByLabel('Muted')).toBeVisible({ timeout: 10_000 });

  await ownerPage.getByRole('button', { name: 'Leave the huddle' }).click();
  await expect(ownerStage).toHaveCount(0);
  await expect(guestStage.getByText('1 person')).toBeVisible({ timeout: 10_000 });

  await guest.close();
  await owner.close();
});

test('a huddle survives walking to another channel', async ({ page }) => {
  const slug = unique('walk');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Walk');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  for (const name of ['general', 'random']) {
    await page.getByRole('button', { name: 'New channel' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${name}$`));
  }

  await page.goto(`/w/${slug}/c/general`);
  await page.getByRole('button', { name: 'Huddle', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Huddle' })).toBeVisible();

  // Through the sidebar rather than a reload: a full navigation would tear
  // down the page, and hanging up is the correct thing for that to do.
  await page.getByRole('link', { name: 'random', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/random$/);
  await expect(page.getByRole('link', { name: 'In a huddle in #general' })).toBeVisible();

  // Back where it started, the call is the stage again rather than the strip.
  await page.getByRole('link', { name: 'In a huddle in #general' }).click();
  await expect(page.getByRole('region', { name: 'Huddle' })).toBeVisible();
});
