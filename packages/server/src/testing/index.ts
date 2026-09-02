import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR, type Database } from '@huddle/db';
import * as schema from '@huddle/db/schema';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createApp, type App } from '../app.js';
import { loadConfig, type Config } from '../config.js';
import { MemoryBlobs } from '../storage/blobs.js';

/**
 * A real Postgres, in process, migrated with the same files production runs.
 *
 * Full text search, `jsonb`, row locks and `RETURNING` all behave differently
 * enough elsewhere that a fake database would hide exactly the bugs these
 * tests exist to catch, and PGlite means catching them costs no container.
 */
export async function createTestApp(overrides: Partial<Config> = {}): Promise<App> {
  const client = new PGlite();
  const local = drizzle(client, { schema });

  // The migrator is bound to one driver, so it runs against the concrete
  // handle before that handle is widened to the shape services accept.
  await migrate(local, { migrationsFolder: MIGRATIONS_DIR });
  const db: Database = local;

  const config: Config = {
    ...loadConfig({ DATABASE_URL: 'postgres://unused', PUBLIC_URL: 'http://localhost:3000' }),
    ...overrides,
  };

  return createApp({
    config,
    overrides: { db, blobs: new MemoryBlobs(), close: () => client.close() },
  });
}
