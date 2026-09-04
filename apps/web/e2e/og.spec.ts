import { test } from '@playwright/test';

/**
 * The social card, rendered rather than drawn.
 *
 * It uses the running app's own fonts and colour tokens, so the card cannot
 * drift away from what somebody sees after clicking it. Run it deliberately:
 * HUDDLE_BUILD_OG=1 npx playwright test og.spec.ts
 */
test('render the social card', async ({ page }) => {
  test.skip(process.env.HUDDLE_BUILD_OG !== '1', 'Only built on request');

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto('/');

  await page.evaluate(() => {
    document.body.innerHTML = `
      <main id="card" style="
        width:1200px;height:630px;box-sizing:border-box;
        padding:88px 96px;display:flex;flex-direction:column;justify-content:space-between;
        background:
          radial-gradient(1100px 620px at 88% -12%, color-mix(in oklab, var(--accent) 20%, transparent), transparent 62%),
          var(--surface);
        color:var(--text-primary);
      ">
        <div>
          <div style="display:flex;align-items:center;gap:14px">
            <span style="width:44px;height:44px;border-radius:13px;background:var(--accent);display:grid;place-items:center;color:#fff;font:600 24px var(--font-display)">h</span>
            <span style="font:600 30px var(--font-display);letter-spacing:-0.02em">huddle</span>
          </div>
          <h1 style="margin:44px 0 0;font:600 76px/1.04 var(--font-display);letter-spacing:-0.035em;max-width:15ch">
            Team chat you<br/>actually host yourself
          </h1>
          <p style="margin:26px 0 0;font:400 27px/1.45 var(--font-ui);color:var(--text-secondary);max-width:30ch">
            Channels, threads, huddles and search. Direct messages end to end encrypted.
          </p>
        </div>
        <div style="display:flex;gap:10px;font:500 20px var(--font-ui);color:var(--text-secondary)">
          ${['One container', 'Postgres and S3', 'MIT licensed']
            .map(
              (chip) =>
                `<span style="border:1px solid var(--border);background:var(--surface-raised);border-radius:999px;padding:11px 20px">${chip}</span>`,
            )
            .join('')}
        </div>
      </main>`;
  });

  await page.waitForTimeout(600);
  await page.locator('#card').screenshot({ path: 'public/og.png' });
});
