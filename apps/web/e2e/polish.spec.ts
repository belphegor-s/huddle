import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

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

async function workspaceWithChannel(page: Page, slug: string): Promise<void> {
  await signIn(page, `${slug}@example.com`);
  await page.getByLabel('Team name').fill('Polish');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('general');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/general$/);
}

test('nothing destructive happens without being asked first', async ({ page }) => {
  const slug = unique('confirm');
  await workspaceWithChannel(page, slug);

  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('a message worth keeping');
  await composer.press('Enter');

  const messages = page.getByRole('list', { name: 'Messages' });
  await expect(messages.getByText('a message worth keeping')).toBeVisible();

  await messages.getByRole('listitem').last().hover();
  await page.getByRole('button', { name: 'Delete message' }).click();

  // The message is still there while the question is on screen.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Delete this message')).toBeVisible();
  await expect(messages.getByText('a message worth keeping')).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(messages.getByText('a message worth keeping')).toBeVisible();

  await messages.getByRole('listitem').last().hover();
  await page.getByRole('button', { name: 'Delete message' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

  await expect(messages.getByText('a message worth keeping')).toHaveCount(0);
  await expect(messages.getByText('Message deleted')).toBeVisible();
});

test('a reaction picker is not clipped by the list it opens inside', async ({ page }) => {
  const slug = unique('picker');
  await workspaceWithChannel(page, slug);

  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('react to this');
  await composer.press('Enter');

  const messages = page.getByRole('list', { name: 'Messages' });
  await expect(messages.getByText('react to this')).toBeVisible();

  await messages.getByRole('listitem').last().hover();
  await page.getByRole('button', { name: 'Add a reaction' }).click();

  const picker = page.getByRole('dialog', { name: 'Pick a reaction' });
  await expect(picker).toBeVisible();

  // The panel used to sit inside the scrolling list with a z-index, where it
  // was both clipped and coverable. In the top layer it is neither.
  const onTop = await picker.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return element.contains(at);
  });
  expect(onTop).toBe(true);

  await picker.getByRole('button').first().click();
  await expect(picker).toBeHidden();
});

test('a huddle tile can be pinned to the stage', async ({ page }) => {
  const slug = unique('pin');
  await workspaceWithChannel(page, slug);

  await page.getByRole('button', { name: 'Huddle', exact: true }).click();
  const stage = page.getByRole('region', { name: 'Huddle' });
  await expect(stage).toBeVisible();

  const pin = stage.getByRole('button', { name: /^Pin / });
  await expect(pin).toBeVisible();
  await pin.click();

  // Pinning gives that tile the stage, which is a different layout: the pin
  // becomes an unpin and the filmstrip appears beside it.
  await expect(stage.getByRole('button', { name: /^Unpin / })).toBeVisible();

  await stage.getByRole('button', { name: /^Unpin / }).click();
  await expect(stage.getByRole('button', { name: /^Pin / })).toBeVisible();

  await stage.getByRole('button', { name: 'Leave the huddle' }).click();
});

test.describe('avatar', () => {
  test.beforeEach(async ({ request }) => {
    const health = (await (await request.get('/api/health')).json()) as { files: boolean };
    test.skip(!health.files, 'No bucket is configured');
  });

  test('a picture is cropped and shrunk before it is ever uploaded', async ({ page }) => {
    const slug = unique('avatar');
    await workspaceWithChannel(page, slug);
    await page.goto(`/w/${slug}/you`);

    // A deliberately oversized photo, the shape a phone actually produces.
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1200;

      const context = canvas.getContext('2d');
      if (!context) throw new Error('no canvas');

      // Noise, because flat colour compresses to nothing and would not be a
      // fair stand in for a photograph.
      const pixels = context.createImageData(canvas.width, canvas.height);
      for (let at = 0; at < pixels.data.length; at += 4) {
        pixels.data[at] = Math.random() * 255;
        pixels.data[at + 1] = Math.random() * 255;
        pixels.data[at + 2] = Math.random() * 255;
        pixels.data[at + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/png');
    });

    const original = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
    expect(original.byteLength).toBeGreaterThan(1_000_000);

    await page.locator('input[type=file]').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: original,
    });

    await expect(page.getByRole('dialog', { name: /Crop your picture/ })).toBeVisible();
    await page.getByRole('button', { name: 'Use this' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });

    // If the upload fails the page says so, and that sentence is far more
    // useful in a report than a locator timing out on a missing image.
    await expect(page.getByRole('alert')).toHaveCount(0);

    const picture = page.locator('img[alt=""]').first();
    await expect(picture).toBeVisible({ timeout: 45_000 });

    // What was actually stored, fetched back. This is the whole claim: the
    // server never handles the original, and what it does hold is a small
    // square rather than a photograph.
    const stored = await picture.evaluate(async (element: HTMLImageElement) => {
      const response = await fetch(element.src);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);

      return { size: blob.size, width: bitmap.width, height: bitmap.height, type: blob.type };
    });

    expect(stored.width).toBe(512);
    expect(stored.height).toBe(512);
    expect(stored.type).toContain('webp');
    expect(stored.size).toBeLessThan(original.byteLength / 10);
  });
});
