export * as schema from './schema.js';
export * from './schema.js';

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schemaModule from './schema.js';

type Schema = typeof schemaModule;

/**
 * The database shape every adapter provides. D1 and libSQL differ only in the
 * driver's raw run result, which nothing above the adapters ever looks at, so
 * it is left as `unknown` here. Naming the two concrete classes in a union
 * instead would collapse Drizzle's overloads and quietly forbid projections
 * and joins.
 */
export type HuddleDatabase = BaseSQLiteDatabase<'async', unknown, Schema>;
