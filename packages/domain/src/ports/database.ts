import type { HuddleDatabase } from '@huddle/db';

/**
 * Drizzle over SQLite, whether that is D1 or libSQL. Drizzle is a query
 * builder rather than a hosting dependency, so depending on it here does not
 * tie the domain to a platform.
 */
export type Database = HuddleDatabase;
