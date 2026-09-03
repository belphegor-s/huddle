import { fileURLToPath } from 'node:url';

/**
 * Where the test server's stdout goes. With no mail provider configured the
 * sign in link is printed rather than sent, and the tests read it back from
 * here rather than reaching into the database to mint a session.
 */
export const SERVER_LOG = fileURLToPath(new URL('../e2e-server.log', import.meta.url));
