import type { Config } from '@react-router/dev/config';

/**
 * A static bundle, not a server rendered app. The API is a separate process
 * that serves these files, so there is no Node runtime inside the client
 * build and the whole app can also be dropped on any static host pointed at a
 * huddle server.
 *
 * The landing page is prerendered because it is the one route a search engine
 * or a link preview ever sees.
 */
export default {
  ssr: false,
  prerender: ['/'],
} satisfies Config;
