import { defineConfig } from 'vitest/config';

/**
 * Deliberately separate from vite.config.ts. That config loads the Cloudflare
 * plugin, which expects a Worker environment and cannot start under Vitest.
 * Browser behaviour is covered by Playwright, not here.
 */
export default defineConfig({
  test: {
    include: ['app/**/*.test.ts', 'app/**/*.test.tsx'],
  },
});
