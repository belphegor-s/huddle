import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/*
 * Defaults to the port a normal install uses, because the upload test sends
 * bytes from the browser straight to the bucket and the bucket's CORS rules
 * name an exact origin. A different port here is a different origin, and the
 * upload is refused before it starts.
 */
const PORT = Number(process.env.HUDDLE_E2E_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Runs against the real process: the built client, the API and the WebSocket on
 * one origin, exactly as a deployment serves them. Anything less would not
 * exercise the socket, the cookie or the SPA fallback, which is most of what
 * can break between the two halves of this repo.
 *
 * It needs a Postgres. DATABASE_URL is read from the environment, so CI points
 * it at a service container and a laptop points it at whatever is already
 * running.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 1 : 0,
  workers: 1,
  reporter: process.env.CI === 'true' ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A call test needs a camera and a microphone. These give Chromium a
        // synthetic one and stop it asking, which is the only way the mesh can
        // be exercised end to end rather than mocked.
        permissions: ['microphone', 'camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            // Chrome publishes host candidates as .local mDNS names, which
            // nothing resolves inside a test browser, so two peers on this
            // machine never find each other. On a real network mDNS works and
            // this flag is not wanted.
            '--disable-features=WebRtcHideLocalIpsWithMdns',
            // getDisplayMedia opens a picker, which no test can answer.
            '--auto-select-desktop-capture-source=Entire screen',
          ],
        },
      },
    },
  ],

  webServer: {
    // Built, not the dev server: a bug that only appears in the real bundle is
    // exactly the kind worth catching here.
    // Stdout goes to a file because the sign in link is printed rather than
    // mailed when no provider is configured, and the test reads it back.
    command:
      'pnpm --filter @huddle/web build && pnpm --filter @huddle/app build && node ../server/dist/main.js > e2e-server.log 2>&1',
    cwd: '.',
    url: `${BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: process.env.CI !== 'true',
    env: {
      PORT: String(PORT),
      PUBLIC_URL: BASE_URL,
      WEB_DIR: fileURLToPath(new URL('./build/client', import.meta.url)),
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      // Every test signs in, from one address.
      MAGIC_LINKS_PER_HOUR_PER_IP: '10000',
      // No mail provider and no model: the flows under test need neither, and
      // a test that depends on a third party is not a test.
      SMTP_URL: '',
      AI_BASE_URL: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',

      // The bucket is passed through rather than blanked. Uploads go from the
      // browser straight to it, which is the one path a server side test can
      // never cover, so it runs wherever credentials exist and skips itself
      // where they do not.
      S3_BUCKET: process.env.S3_BUCKET ?? '',
      S3_REGION: process.env.S3_REGION ?? 'us-east-1',
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? '',
      S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? 'false',
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? '',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  },
});
