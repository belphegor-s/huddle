import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from './schema.js';
import { MIGRATIONS_DIR } from './migrations-dir.js';

/**
 * Written against the driver independent Drizzle surface rather than the
 * node-postgres one. The production process talks to Postgres over a socket,
 * and the test suite runs the identical queries against an in process Postgres,
 * so the type has to admit both without either being the special case.
 */
export type Database = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface Connection {
  db: Database;
  /**
   * Kept on the connection rather than exposed as a free function, because a
   * migrator is bound to one driver while the database type deliberately is
   * not.
   */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * One pool per process. The pool is small on purpose: a chat server spends its
 * time on open sockets, not on concurrent queries, and a large pool against a
 * small Postgres is a way to run out of connections rather than to go faster.
 */
export function connect(url: string, options?: { max?: number }): Connection {
  const pool = new Pool({ connectionString: url, max: options?.max ?? 10 });
  const db = drizzle(pool, { schema });

  return {
    db,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => pool.end(),
  };
}
