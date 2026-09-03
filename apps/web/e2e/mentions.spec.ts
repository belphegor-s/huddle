import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

test('an @ opens the picker and the mention lands highlighted', async ({ browser }) => {
  const slug = `men${Date.now().toString(36)}`;

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, `owner-${slug}@example.com`);

  await ownerPage.getByLabel('Team name').fill('Mentions');
  await ownerPage.getByLabel('Address').fill(slug);
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/w/${slug}$`));

  await ownerPage.getByRole('button', { name: 'New channel' }).click();
  await ownerPage.getByLabel('Name').fill('general');
  await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(ownerPage).toHaveURL(/\/c\/general$/);

  // A second person, so there is somebody to mention.
  await ownerPage.goto(`/w/${slug}/people`);
  await ownerPage.getByRole('button', { name: 'Create an invite link' }).click();
  await expect(ownerPage.locator('output')).toBeVisible();
  const invitePath = new URL((await ownerPage.locator('output').textContent()) ?? '').pathname;

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await signIn(guestPage, `guest-${slug}@example.com`);
  await guestPage.goto(invitePath);
  await guestPage.getByRole('button', { name: 'Join workspace' }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}$`));

  // A mention only counts for someone who is in the channel, so the guest
  // joins it before anyone says their name.
  await guestPage.goto(`/w/${slug}/c/general`);
  await guestPage.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(guestPage.getByRole('button', { name: 'Join', exact: true })).toBeHidden();

  // Away from the channel, or reading it would mark the mention read the
  // instant it arrived.
  await guestPage.goto(`/w/${slug}`);

  await ownerPage.reload();
  await ownerPage.goto(`/w/${slug}/c/general`);

  const composer = ownerPage.getByLabel('Message', { exact: true });
  await composer.fill('morning @guest');

  const picker = ownerPage.getByRole('listbox', { name: 'People you can mention' });
  await expect(picker).toBeVisible();

  await composer.press('Enter');
  // The handle comes from the display name, which is derived from the address.
  await expect(composer).toHaveValue(/@guest\./);
  await expect(picker).toBeHidden();

  await composer.press('Enter');

  // Rendered with the person's name rather than the raw handle.
  const messages = ownerPage.getByRole('list', { name: 'Messages' });
  await expect(messages.getByText(/^@Guest /)).toBeVisible();

  // It counted for the person named, and the badge arrives over the socket
  // without them reloading anything.
  await expect(guestPage.getByRole('link', { name: /general/ })).toContainText('1', {
    timeout: 10_000,
  });

  await owner.close();
  await guest.close();
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
