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
  await ownerPage.getByRole('button', { name: 'Start a huddle' }).click();

  const ownerStage = ownerPage.getByRole('region', { name: 'Huddle' });
  await expect(ownerStage).toBeVisible();
  await expect(ownerStage.getByText('1 person')).toBeVisible();

  // The guest is told about the call without being in it or reloading.
  const join = guestPage.getByRole('button', { name: 'Join the huddle, 1 in it' });
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

  /*
   * The call takes the panel rather than a slice of it. A split gave neither
   * half enough room: a shared screen was unreadable and the conversation was
   * three lines tall.
   */
  const window = ownerPage.viewportSize();
  const covered = () =>
    ownerPage.evaluate(() => {
      const field = document.querySelector('textarea[aria-label="Message"]');
      if (!field) return true;

      const box = field.getBoundingClientRect();
      const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return at === null || at.closest('[aria-label="Huddle"]') !== null;
    });

  // Covered rather than hidden: the composer is still in the page, and what
  // matters is that nothing of the conversation is left half visible under a
  // call taking a slice of the panel.
  expect(await covered()).toBe(true);

  await ownerPage.getByRole('button', { name: 'Full screen' }).click();
  const full = (await ownerStage.boundingBox())?.width ?? 0;
  expect(full).toBeGreaterThan((window?.width ?? 0) * 0.9);
  await expect(ownerStage.getByText('2 people')).toBeVisible();

  // Back through the control rather than Escape: once the browser has granted
  // real fullscreen, Escape belongs to the browser, and the visible way out is
  // the one that has to work.
  await ownerPage.getByRole('button', { name: 'Leave full screen' }).click();
  await expect(ownerPage.getByRole('button', { name: 'Full screen' })).toBeVisible();

  // In the corner, the conversation underneath is readable again and the call
  // is still running.
  await ownerPage.getByRole('button', { name: 'Put the huddle in the corner' }).click();
  await expect
    .poll(async () => (await ownerStage.boundingBox())?.width ?? 0)
    .toBeLessThan((window?.width ?? 0) / 2);
  expect(await covered()).toBe(false);

  // And every control that matters is still reachable there.
  await expect(ownerStage.getByRole('button', { name: 'Leave the huddle' })).toBeVisible();

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
  await page.getByRole('button', { name: 'Start a huddle' }).click();
  await expect(page.getByRole('region', { name: 'Huddle' })).toBeVisible();

  // Through the sidebar rather than a reload: a full navigation would tear
  // down the page, and hanging up is the correct thing for that to do.
  await page.getByRole('link', { name: 'random', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/random$/);

  /*
   * Still running, in the corner. The call does not belong to the channel view
   * any more, so walking away moves it rather than tearing it down.
   */
  const stage = page.getByRole('region', { name: 'Huddle' });
  await expect(stage).toBeVisible();

  const corner = await stage.boundingBox();
  const window = page.viewportSize();
  expect(corner?.width ?? 0).toBeLessThan((window?.width ?? 0) / 2);

  // Back where it started, it takes the panel again.
  await page.getByRole('link', { name: '#general' }).click();
  await expect(page).toHaveURL(/\/c\/general$/);
  await expect
    .poll(async () => (await stage.boundingBox())?.width ?? 0)
    .toBeGreaterThan((window?.width ?? 0) / 2);
});

test('a camera turned on mid call reaches the other end', async ({ browser }) => {
  const slug = unique('late');

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, `owner-${slug}@example.com`);

  await ownerPage.getByLabel('Team name').fill('Late');
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
  await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}$`));

  await ownerPage.goto(`/w/${slug}/c/general`);
  await guestPage.goto(`/w/${slug}/c/general`);

  await ownerPage.getByRole('button', { name: 'Start a huddle' }).click();
  await guestPage.getByRole('button', { name: /Join the huddle/ }).click();
  await expect(guestPage.getByRole('region', { name: 'Huddle' })).toBeVisible();

  /*
   * Nobody joins with a camera, and turning one on later adds a track, which
   * asks for a renegotiation. An ask that arrived at the wrong moment used to
   * be dropped with nothing to run it again, so the camera went nowhere until
   * whoever turned it on rejoined the call.
   */
  const inbound = () =>
    guestPage.evaluate(() =>
      [...document.querySelectorAll('video')].some((element) => {
        const stream = element.srcObject as MediaStream | null;
        return (stream?.getVideoTracks() ?? []).some((track) => track.readyState === 'live');
      }),
    );

  await expect.poll(inbound, { timeout: 10_000 }).toBe(false);

  await ownerPage.getByRole('button', { name: 'Turn the camera on' }).click();
  await expect.poll(inbound, { timeout: 30_000 }).toBe(true);

  await guest.close();
  await owner.close();
});
