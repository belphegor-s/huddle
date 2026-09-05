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
    const lines = [
      ['PR', 'Priya', 'Where did we land on the pricing copy?'],
      ['SA', 'Sam', 'Thread in #launch, decision is pinned.'],
      ['AD', 'Ada', 'Deployed to our own box this morning.'],
    ];

    document.body.innerHTML = `
      <main id="card" style="
        width:1200px;height:630px;box-sizing:border-box;display:flex;align-items:center;gap:64px;
        padding:0 84px;
        background:
          radial-gradient(900px 700px at 100% 0%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 60%),
          var(--surface);
        color:var(--text-primary);
      ">
        <div style="flex:1 1 0;min-width:0">
          <div style="display:flex;align-items:center;gap:13px">
            <span style="width:42px;height:42px;border-radius:12px;background:var(--accent);display:grid;place-items:center;color:#fff;font:600 23px var(--font-display)">h</span>
            <span style="font:600 29px var(--font-display);letter-spacing:-0.02em">huddle</span>
          </div>
          <h1 style="margin:34px 0 0;font:600 66px/1.05 var(--font-display);letter-spacing:-0.035em">
            Team chat you<br/>actually host<br/>yourself
          </h1>
          <p style="margin:24px 0 0;font:400 24px/1.45 var(--font-ui);color:var(--text-secondary);max-width:24ch">
            Channels, threads, huddles and search. Direct messages end to end encrypted.
          </p>
          <div style="display:flex;gap:9px;margin-top:30px;font:500 18px var(--font-ui);color:var(--text-secondary)">
            ${['One container', 'Postgres and S3', 'MIT licensed']
              .map(
                (chip) =>
                  `<span style="border:1px solid var(--border);background:var(--surface-raised);border-radius:999px;padding:9px 18px">${chip}</span>`,
              )
              .join('')}
          </div>
        </div>

        <!--
          The product, not an empty half. A card that is text on one side and
          nothing on the other reads as a slide somebody did not finish.
        -->
        <div style="
          width:452px;flex:0 0 452px;border:1px solid var(--border);border-radius:18px;
          background:var(--surface-raised);box-shadow:0 24px 60px -20px rgb(0 0 0 / 0.22);overflow:hidden;
        ">
          <div style="display:flex;align-items:center;gap:9px;padding:15px 20px;border-bottom:1px solid var(--border);font:400 16px var(--font-ui);color:var(--text-secondary)">
            <span style="color:var(--text-muted);font-family:var(--font-mono)">#</span>
            <span style="color:var(--text-primary);font-weight:500">launch</span>
            <span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;color:var(--positive)">
              <span style="width:8px;height:8px;border-radius:999px;background:var(--positive);display:inline-block"></span>
              3 in a huddle
            </span>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:19px">
            ${lines
              .map(
                ([initials, who, text], index) => `
                <div style="display:flex;gap:12px">
                  <span style="width:36px;height:36px;flex:0 0 36px;border-radius:10px;background:var(--surface-sunken);color:var(--text-secondary);display:grid;place-items:center;font:600 13px var(--font-ui)">${initials}</span>
                  <div style="min-width:0">
                    <div style="font:600 16px var(--font-ui)">${who}</div>
                    <div style="font:400 18px/1.45 var(--font-ui);color:${index === 2 ? 'var(--accent)' : 'var(--text-primary)'}">${text}</div>
                  </div>
                </div>`,
              )
              .join('')}
            <div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:12px;padding:11px 14px;color:var(--text-muted);font:400 17px var(--font-ui)">
              Message #launch
            </div>
          </div>
        </div>
      </main>`;
  });

  await page.waitForTimeout(600);
  await page.locator('#card').screenshot({ path: 'public/og.png' });
});
