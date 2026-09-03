import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PORT = 3100;
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

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

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
      // No mail provider, no bucket, no model: the flows under test need none
      // of them, and a test that depends on a third party is not a test.
      SMTP_URL: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      AI_BASE_URL: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
    },
  },
});
