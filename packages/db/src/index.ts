export * as schema from './schema.js';
export * from './schema.js';

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type * as schemaModule from './schema.js';

type Schema = typeof schemaModule;

/**
 * The database shape every adapter provides. Drizzle types the driver's raw
 * run result into the database class, so D1 and libSQL are not structurally
 * interchangeable and a single base type cannot cover both. A union is the
 * honest way to say "one of these two", and every query builder method we use
 * has an identical signature on both sides.
 */
export type HuddleDatabase = DrizzleD1Database<Schema> | LibSQLDatabase<Schema>;
