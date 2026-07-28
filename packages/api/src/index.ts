import type { Ports } from '@huddle/domain';
import { Hono } from 'hono';

export interface ApiEnv {
  Variables: {
    ports: Ports;
  };
}

/**
 * Every route is written against ports, so this same app object is mounted by
 * the Cloudflare Worker and by the Node server without modification. If a
 * route ever needs a platform binding directly, the port is missing a method.
 */
export function createApi(ports: Ports): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.use('*', async (c, next) => {
    c.set('ports', ports);
    await next();
  });

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      time: ports.clock.now(),
      ai: ports.ai.available,
    }),
  );

  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'request_failed',
        path: c.req.path,
        message: error.message,
      }),
    );
    return c.json({ error: 'internal' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
