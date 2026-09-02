import { fileURLToPath } from 'node:url';

/**
 * The migration files, resolved from this module rather than the working
 * directory, so they are found whether the app runs from source, from dist, or
 * from inside a container.
 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
