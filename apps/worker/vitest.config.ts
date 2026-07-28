import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Runs in real workerd against real Durable Object storage. A mocked SQLite
 * would not catch the ordering bugs these tests exist to catch.
 */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
});
