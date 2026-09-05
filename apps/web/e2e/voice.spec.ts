import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * A voice note, from holding the microphone to hearing it back.
 *
 * It skips itself where no bucket is configured, because the recording goes
 * from the browser straight to storage like any other attachment.
 */
test.describe('voice notes', () => {
  test.beforeEach(async ({ request }) => {
    const health = (await (await request.get('/api/health')).json()) as { files: boolean };
    test.skip(!health.files, 'No bucket is configured');
  });

  test('records, stops and arrives with a waveform worth looking at', async ({ page }) => {
    const slug = `voice${Date.now().toString(36)}`;
    await signIn(page, `${slug}@example.com`);

    await page.getByLabel('Team name').fill('Voice');
    await page.getByLabel('Address').fill(slug);
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await page.getByRole('button', { name: 'New channel' }).click();
    await page.getByLabel('Name').fill('general');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/c\/general$/);

    await page.getByRole('button', { name: 'Record a voice note' }).click();

    // The control that ends a recording has to be visible against what is
    // behind it. It was once a white glyph on the near white surface, which
    // left no way to stop a recording at all.
    const stop = page.getByRole('button', { name: 'Stop and attach' });
    await expect(stop).toBeVisible();

    const contrast = await stop.evaluate((element) => {
      const style = getComputedStyle(element);
      const read = (value: string) =>
        (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((one) => Number(one) / 255);

      // Relative luminance, the way the accessibility guidelines define it.
      const luminance = (rgb: number[]) => {
        const [r = 0, g = 0, b = 0] = rgb.map((channel) =>
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        );
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };

      const front = luminance(read(style.color));
      const back = luminance(read(style.backgroundColor));
      return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    });

    expect(contrast).toBeGreaterThan(3);

    await page.waitForTimeout(3000);
    await stop.click();

    const send = page.getByRole('button', { name: 'Send' });
    await expect(send).toBeEnabled({ timeout: 30_000 });
    await send.click();

    // A note of a few seconds used to arrive with a single bar, because the
    // recorder spread its samples across the maximum length a note may be.
    const player = page.getByRole('slider', { name: 'Seek within the voice note' });
    await expect(player).toBeVisible({ timeout: 20_000 });
    expect(await player.locator('span').count()).toBeGreaterThan(16);

    /*
     * The highlight has to move while it plays. It used to sit at zero for
     * the whole note, because a file from MediaRecorder carries no duration
     * in its header and every position worked out from the element read NaN.
     */
    await expect(player).toHaveAttribute('aria-valuenow', '0');
    await page.getByRole('button', { name: 'Play voice note' }).click();

    // Bounded on both sides. Dividing by a length the browser has not worked
    // out yet gives Infinity, and an unbounded assertion passes on that,
    // which is how a broken bar can look tested.
    await expect
      .poll(async () => Number(await player.getAttribute('aria-valuenow')), { timeout: 20_000 })
      .toBeGreaterThan(5);

    const position = Number(await player.getAttribute('aria-valuenow'));
    expect(Number.isFinite(position)).toBe(true);
    expect(position).toBeLessThanOrEqual(100);

    const bars = player.locator('span.bg-accent');
    await expect.poll(async () => bars.count(), { timeout: 20_000 }).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Pause voice note' }).click();

    // Scrubbing has to work without a mouse.
    await player.focus();
    await player.press('End');
    await expect(player).toHaveAttribute('aria-valuenow', '100');

    // Speed cycles, and reaches the element rather than only the label.
    const speed = page.getByRole('button', { name: /Playback speed/ });
    await expect(speed).toHaveText('1x');

    for (const expected of ['1.5x', '2x', '0.5x', '1x']) {
      await speed.click();
      await expect(speed).toHaveText(expected);

      const applied = await page.evaluate(() => {
        const element = document.querySelector('audio');
        return { rate: element?.playbackRate ?? 0, pitch: element?.preservesPitch ?? false };
      });

      expect(applied.rate).toBeCloseTo(Number(expected.replace('x', '')));
      // Otherwise a voice at double speed is a chipmunk.
      expect(applied.pitch).toBe(true);
    }
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
