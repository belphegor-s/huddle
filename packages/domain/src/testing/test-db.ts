import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '@huddle/db/schema';
import { fileURLToPath } from 'node:url';
import type { Database } from '../ports/database.js';

const MIGRATIONS = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

/**
 * A real SQLite database in memory, migrated with the same files that run in
 * production. Fakes are fine for side effects, but a fake database hides the
 * bugs that only real SQL finds.
 */
export async function createTestDatabase(): Promise<Database> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
