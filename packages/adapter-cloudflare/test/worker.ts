export { ChannelRoom, RateCounter } from '@huddle/adapter-cloudflare';

/**
 * The vitest Workers pool needs a Worker entry that exports the Durable Object
 * classes before it can hand tests a namespace binding for them. Nothing is
 * served here, so fetch is never reached in practice.
 */
export default {
  fetch(): Response {
    return new Response('Test worker', { status: 404 });
  },
} satisfies ExportedHandler;
