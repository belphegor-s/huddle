import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * End to end encryption, end to end.
 *
 * Two browsers, a real key exchange over the real API, and the one assertion
 * that matters at the end: the server cannot produce the plaintext of a
 * message it is storing and serving.
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

test('a conversation is readable by both people and by nobody else', async ({ browser }) => {
  const slug = unique('e2ee');
  const secret = `the merger closes on Friday ${slug}`;

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, `ada-${slug}@example.com`);

  await ownerPage.getByLabel('Team name').fill('Cipher');
  await ownerPage.getByLabel('Address').fill(slug);
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/w/${slug}$`));

  await ownerPage.goto(`/w/${slug}/people`);
  await ownerPage.getByRole('button', { name: 'New link' }).click();
  const invite = new URL((await ownerPage.locator('output').first().textContent()) ?? '').pathname;

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await signIn(guestPage, `grace-${slug}@example.com`);
  await guestPage.goto(invite);
  await guestPage.getByRole('button', { name: 'Join workspace' }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}$`));

  // Both devices have to be registered before a key can be sealed to either.
  await ownerPage.goto(`/w/${slug}`);
  await ownerPage.waitForTimeout(1500);
  await guestPage.waitForTimeout(1500);

  await ownerPage.getByRole('button', { name: 'New message' }).click();
  await ownerPage
    .getByRole('button', { name: /Grace|grace/ })
    .first()
    .click();
  await ownerPage.getByRole('button', { name: 'Start conversation' }).click();
  await expect(ownerPage.getByLabel('End to end encrypted')).toBeVisible({ timeout: 15_000 });

  const composer = ownerPage.getByLabel('Message', { exact: true });
  await composer.fill(secret);
  await composer.press('Enter');
  const ownerMessages = ownerPage.getByRole('list', { name: 'Messages' });
  await expect(ownerMessages.getByText(secret)).toBeVisible();

  // Grace opens the conversation. Her device has no key until Ada's browser
  // seals one for it, which happens because Ada has the channel open.
  await guestPage.reload();
  await guestPage
    .getByRole('link', { name: /Ada|ada/ })
    .first()
    .click();

  await ownerPage.reload();
  await ownerPage.waitForTimeout(2500);
  await guestPage.reload();

  await expect(guestPage.getByRole('list', { name: 'Messages' }).getByText(secret)).toBeVisible({
    timeout: 30_000,
  });

  /*
   * The point of the whole exercise. The API is asked, with a valid session
   * belonging to somebody in the conversation, for the very messages it just
   * served. It hands over the message and cannot produce the words in it.
   */
  const channelId = /\/c\/([^/?#]+)/.exec(guestPage.url())?.[1] ?? '';
  expect(channelId).not.toBe('');

  const served = await guestPage.evaluate(async (id: string) => {
    const response = await fetch(`/api/channels/${id}/messages`, {
      headers: { accept: 'application/json' },
    });
    return await response.text();
  }, channelId);

  // It is really the message, and it is really unreadable.
  expect(served).toContain('"epoch":0');
  expect(served).not.toContain(secret);
  expect(served).not.toContain('merger');

  await guest.close();
  await owner.close();
});
