import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the migration files are, which depends on how the process was started.
 *
 * Running from source this module sits next to them. Bundled, `import.meta.url`
 * is the bundle, so they are wherever the build put them. Rather than assume
 * one layout and fail at the first query, each is tried and the failure names
 * everything it looked at.
 */
const CANDIDATES = [
  process.env.HUDDLE_MIGRATIONS_DIR,
  // From source: packages/db/src -> packages/db/migrations.
  // From the bundle: apps/server/dist -> apps/server/migrations, which is
  // where the build copies them and where the container image holds them.
  fileURLToPath(new URL('../migrations', import.meta.url)),
  // A bundle run in place from the repo, with nothing copied.
  fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
];

function resolve(): string {
  const tried: string[] = [];

  for (const candidate of CANDIDATES) {
    if (candidate === undefined || candidate === '') continue;
    tried.push(candidate);
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
  }

  throw new Error(
    `Could not find the database migrations. Looked in:\n  ${tried.join('\n  ')}\n` +
      'Set HUDDLE_MIGRATIONS_DIR if they live somewhere else.',
  );
}

export const MIGRATIONS_DIR = resolve();
