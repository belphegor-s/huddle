import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * The life of a channel: made, seen by everybody at once, archived, read from
 * the archive, restored, and deleted for good.
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
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

async function makeChannel(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${name}$`));
}

/** `rgb(a, b, c)` as `#aabbcc`, so a computed colour can meet a token. */
function hexOf(colour: string): string {
  const parts = (colour.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  if (parts.length < 3) return colour;
  return `#${parts.map((one) => one.toString(16).padStart(2, '0')).join('')}`;
}

/** The button in the confirm dialog, not one behind it wearing the same word. */
async function confirmWith(page: Page, action: string): Promise<void> {
  await page.locator('dialog[open]').getByRole('button', { name: action, exact: true }).click();
}

async function closeAll(...contexts: BrowserContext[]): Promise<void> {
  for (const context of contexts) await context.close();
}

test('a new channel reaches the other person without a reload', async ({ browser }) => {
  const slug = unique('live');

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, `owner-${slug}@example.com`);

  await ownerPage.getByLabel('Team name').fill('Live');
  await ownerPage.getByLabel('Address').fill(slug);
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/w/${slug}$`));

  await ownerPage.goto(`/w/${slug}/people`);
  await ownerPage.getByRole('button', { name: 'New link' }).click();
  const invite = new URL((await ownerPage.locator('output').first().textContent()) ?? '').pathname;

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await signIn(guestPage, `guest-${slug}@example.com`);
  await guestPage.goto(invite);
  await guestPage.getByRole('button', { name: 'Join workspace' }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}$`));

  /*
   * The guest sits still from here. A channel is not a message in a channel,
   * so the fanout that carries messages reaches nobody who has not subscribed
   * to it, which for a channel that did not exist a moment ago is everybody.
   * Without a notice of its own the other side finds out by reloading.
   */
  await ownerPage.goto(`/w/${slug}`);
  await makeChannel(ownerPage, 'general');

  const sidebar = guestPage.getByRole('navigation');
  await expect(sidebar.getByRole('link', { name: /general/ })).toBeVisible({ timeout: 10_000 });

  // Archiving it takes it back out of the other sidebar, live as well.
  await ownerPage.getByRole('button', { name: 'Channel settings' }).click();
  await ownerPage.getByRole('menuitem', { name: 'Archive channel' }).click();
  await confirmWith(ownerPage, 'Archive');

  await expect(sidebar.getByRole('link', { name: /general/ })).toBeHidden({ timeout: 10_000 });

  await closeAll(owner, guest);
});

test('an archived channel can be read, restored and finally deleted', async ({ page }) => {
  const slug = unique('arch');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Archives');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await makeChannel(page, 'launch');

  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('shipping on Friday');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByRole('list', { name: 'Messages' }).getByText('shipping on Friday'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Channel settings' }).click();
  await page.getByRole('menuitem', { name: 'Archive channel' }).click();
  await confirmWith(page, 'Archive');
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  /*
   * The point of archiving rather than deleting. Before this the messages were
   * kept and nobody could reach them, which is a delete with a kinder word on
   * the button.
   */
  await page.goto(`/w/${slug}/settings`);
  const archived = page.getByRole('link', { name: '#launch' });
  await expect(archived).toBeVisible();

  await archived.click();
  await expect(page.getByText('shipping on Friday')).toBeVisible();
  await expect(page.getByText('This channel is archived')).toBeVisible();
  // Nothing more can be said in it, so there is nothing to say it with.
  await expect(page.getByLabel('Message', { exact: true })).toBeHidden();

  // And the name it had is free, which it was not before.
  await page.goto(`/w/${slug}`);
  await makeChannel(page, 'launch');

  await page.goto(`/w/${slug}/settings`);
  await expect(page.getByRole('link', { name: '#launch' })).toBeVisible();

  // Restoring is refused while the name belongs to the newer channel.
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/Another channel is called launch/)).toBeVisible();

  const archivedRow = page.getByRole('listitem').filter({ hasText: '#launch' });
  const remove = archivedRow.getByRole('button', { name: 'Delete' });

  /*
   * Red, and a box rather than a run of text. A ghost button with a critical
   * colour class on it drew grey: two colour utilities of the same weight, and
   * the stylesheet decides which one wins rather than the order they are
   * written in.
   */
  const drawn = await remove.evaluate((button) => {
    const style = getComputedStyle(button);
    return { colour: style.color, border: style.borderColor };
  });

  const critical = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--critical').trim(),
  );

  expect(critical).not.toBe('');
  expect(hexOf(drawn.colour), 'the delete button is not the danger colour').toBe(critical);
  expect(hexOf(drawn.border), 'the delete button has no danger border').toBe(critical);

  // The pair sits flush at the end of the row rather than floating in it.
  const row = await archivedRow.boundingBox();
  const box = await remove.boundingBox();
  const gap = (row?.x ?? 0) + (row?.width ?? 0) - ((box?.x ?? 0) + (box?.width ?? 0));
  expect(gap, 'the buttons are not against the end of the row').toBeLessThanOrEqual(8);

  await remove.click();
  await confirmWith(page, 'Delete');

  await expect(page.getByText('Nothing is archived.')).toBeVisible();
});

test('a channel deleted for good takes its messages with it', async ({ page }) => {
  const slug = unique('gone');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Gone');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await makeChannel(page, 'mistake');

  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('sent to the wrong place');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByRole('list', { name: 'Messages' }).getByText('sent to the wrong place'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Channel settings' }).click();
  await page.getByRole('menuitem', { name: 'Delete channel' }).click();
  await confirmWith(page, 'Delete');

  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));
  await expect(page.getByRole('navigation').getByRole('link', { name: /mistake/ })).toBeHidden();

  // Not archived either. Deleted means gone.
  await page.goto(`/w/${slug}/settings`);
  await expect(page.getByText('Nothing is archived.')).toBeVisible();

  // And the search index does not keep a copy of what was in it.
  await page.goto(`/w/${slug}/search`);
  await page.getByLabel('Search messages').fill('sent to the wrong place');
  await page.waitForTimeout(1200);
  await expect(page.getByText('sent to the wrong place')).toBeHidden();
});
