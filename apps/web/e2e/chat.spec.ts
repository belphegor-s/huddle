import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * With no mail provider configured the sign in link is printed to the server
 * log instead of sent. The API is the same either way, so the test walks the
 * real flow and reads the link back rather than minting a session by hand.
 */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  const link = await readSignInLink(page, email);
  await page.goto(link);
}

async function readSignInLink(page: Page, email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const lines = readFileSync(SERVER_LOG, 'utf8')
      .split('\n')
      .filter((line) => line.includes('email_not_sent') && line.includes(email));

    const last = lines.at(-1);
    if (last !== undefined) {
      const parsed = JSON.parse(last.slice(last.indexOf('{'))) as { text: string };
      const found = /https?:\/\/\S+/.exec(parsed.text)?.[0];
      if (found) return found;
    }

    await page.waitForTimeout(250);
  }

  throw new Error('No sign in link was written');
}

/** The message list, named so an assertion cannot also match the composer. */
function messages(page: Page) {
  return page.getByRole('list', { name: 'Messages' });
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test('a person signs in, makes a workspace and sends a message', async ({ page }) => {
  const slug = unique('acme');
  await signIn(page, `${slug}@example.com`);

  await expect(page).toHaveURL(/\/new$/);
  await page.getByLabel('Team name').fill('Acme');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));
  await expect(page.getByRole('heading', { name: 'Acme' })).toBeVisible();

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('general');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/w/${slug}/c/general$`));

  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('first message');
  await composer.press('Enter');

  await expect(messages(page).getByText('first message')).toBeVisible();
  await expect(composer).toHaveValue('');

  // Reload: the message came back from Postgres rather than from state.
  await page.reload();
  await expect(messages(page).getByText('first message')).toBeVisible();
});

test('a second person joins by invite and both see each other live', async ({ browser }) => {
  const slug = unique('team');

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, `owner-${slug}@example.com`);

  await ownerPage.getByLabel('Team name').fill('Team');
  await ownerPage.getByLabel('Address').fill(slug);
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/w/${slug}$`));

  await ownerPage.getByRole('button', { name: 'New channel' }).click();
  await ownerPage.getByLabel('Name').fill('general');
  await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/c/general$`));

  const invite = await createInvite(ownerPage, slug);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await signIn(guestPage, `guest-${slug}@example.com`);
  await guestPage.goto(invite);
  await guestPage.getByRole('button', { name: 'Join workspace' }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}$`));

  await guestPage.goto(`/w/${slug}/c/general`);
  await expect(guestPage.getByRole('heading', { name: 'general' })).toBeVisible();

  // Creating the invite left the owner on the workspace home.
  await ownerPage.goto(`/w/${slug}/c/general`);

  // The socket, not a poll: this message is never fetched by the guest.
  const composer = ownerPage.getByLabel('Message', { exact: true });
  await composer.fill('live over the socket');
  await composer.press('Enter');

  await expect(messages(guestPage).getByText('live over the socket')).toBeVisible({
    timeout: 10_000,
  });

  await closeAll(owner, guest);
});

/** Invitations live on the people screen, where the rest of admin does. */
async function createInvite(page: Page, slug: string): Promise<string> {
  await page.goto(`/w/${slug}/people`);
  await page.getByRole('button', { name: 'Create an invite link' }).click();

  const output = page.locator('output');
  await expect(output).toBeVisible();

  const link = (await output.textContent()) ?? '';
  return new URL(link).pathname;
}

async function closeAll(...contexts: BrowserContext[]): Promise<void> {
  for (const context of contexts) await context.close();
}

test('a private channel is invisible to a member who is not in it', async ({ browser }) => {
  const slug = unique('secret');

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, `owner-${slug}@example.com`);

  await ownerPage.getByLabel('Team name').fill('Secret');
  await ownerPage.getByLabel('Address').fill(slug);
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click();

  await ownerPage.getByRole('button', { name: 'New channel' }).click();
  await ownerPage.getByLabel('Name').fill('leadership');
  await ownerPage.getByLabel(/Private/).check();
  await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(ownerPage).toHaveURL(/\/c\/leadership$/);

  const invite = await createInvite(ownerPage, slug);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await signIn(guestPage, `guest-${slug}@example.com`);
  await guestPage.goto(invite);
  await guestPage.getByRole('button', { name: 'Join workspace' }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}$`));

  await guestPage.goto(`/w/${slug}/c/leadership`);
  await expect(guestPage.getByText('Channel not found')).toBeVisible();

  await closeAll(owner, guest);
});
