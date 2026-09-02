import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // PGlite boots a real Postgres per file, which is slower than a fake and
    // worth every millisecond.
    testTimeout: 30_000,
  },
});
