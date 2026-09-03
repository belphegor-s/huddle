import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * The upload path is the one thing a server side test cannot cover: the bytes
 * go from the browser straight to the bucket, so it exercises the bucket's CORS
 * rules rather than anything this codebase controls. Without those rules the
 * server looks perfectly healthy and every upload fails in the browser.
 *
 * It skips itself where no bucket is configured, so CI stays green without
 * credentials.
 */
test.describe('uploads', () => {
  test.beforeEach(async ({ request }) => {
    const health = (await (await request.get('/api/health')).json()) as { files: boolean };
    test.skip(!health.files, 'No bucket is configured');
  });

  test('a file goes from the browser to the bucket and back into a message', async ({ page }) => {
    const slug = `up${Date.now().toString(36)}`;
    await signIn(page, `${slug}@example.com`);

    await page.getByLabel('Team name').fill('Uploads');
    await page.getByLabel('Address').fill(slug);
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await page.getByRole('button', { name: 'New channel' }).click();
    await page.getByLabel('Name').fill('files');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/c\/files$/);

    // A one pixel PNG, so the grid, the aspect ratio box and the lightbox all
    // get a real image rather than a stub.
    await page.setInputFiles('input[type=file]', {
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });

    // The tray shows it while it uploads, and the send button only arms once
    // the bytes are actually there.
    await expect(page.getByText('pixel.png')).toBeVisible();
    const send = page.getByRole('button', { name: 'Send' });
    await expect(send).toBeEnabled({ timeout: 20_000 });
    await send.click();

    const messages = page.getByRole('list', { name: 'Messages' });
    const image = messages.getByRole('img', { name: 'pixel.png' });
    await expect(image).toBeVisible({ timeout: 20_000 });

    // Loaded, not merely present: a broken CORS rule or a bad signature would
    // still render an img element.
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    await image.click();
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  });
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
