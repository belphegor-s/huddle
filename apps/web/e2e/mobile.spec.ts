import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * A phone viewport on chromium rather than a device preset, which would pull in
 * webkit and a second browser download for no extra coverage here.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('a message can be sent and acted on without a hover anywhere', async ({ page }) => {
  const slug = `mb${Date.now().toString(36)}`;
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Acme');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('launch');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/launch$/);

  // Enter is a newline on a touch keyboard, so the button is the only way and
  // it has to work.
  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('shipping **search** first');
  await page.getByRole('button', { name: 'Send' }).click();

  const messages = page.getByRole('list', { name: 'Messages' });
  const row = messages.locator('li').filter({ hasText: 'shipping' }).first();
  await expect(row).toBeVisible();

  // Every action lived behind hover, which does not exist here.
  await row.getByRole('button', { name: 'Message actions' }).click();
  const sheet = page.locator('dialog[open]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Reply in thread')).toBeVisible();

  await sheet
    .getByRole('button', { name: /React with/ })
    .first()
    .click();
  await expect(sheet).toBeHidden();

  // The reaction landed on the message rather than only closing the sheet.
  await expect(row.getByRole('button', { name: /React|\d/ }).first()).toBeVisible();
  await expect(row).toContainText('1');
});

test('the channel list and the conversation are two screens', async ({ page }) => {
  const slug = `nav${Date.now().toString(36)}`;
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Acme');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('general');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/general$/);

  // In the conversation the list is gone, and the way back is a visible
  // control rather than a swipe.
  await expect(page.getByRole('link', { name: 'Back to conversations' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to conversations' }).click();

  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));
  await expect(page.getByRole('link', { name: /general/ })).toBeVisible();
});

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
      const link = /https?:\/\/\S+/.exec(parsed.text)?.[0];
      if (link) {
        await page.goto(link);
        return;
      }
    }
    await page.waitForTimeout(250);
  }

  throw new Error('No sign in link was written');
}
