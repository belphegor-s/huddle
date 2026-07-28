import type { Ports } from '@huddle/domain';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiEnv } from './context.js';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { withSession } from './session.js';

export type { ApiContext, ApiEnv } from './context.js';
export { SESSION_COOKIE } from './session.js';

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

  app.use('/api/*', withSession);

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      time: ports.clock.now(),
      ai: ports.ai.available,
    }),
  );

  app.route('/api/auth', authRoutes());
  app.route('/api', workspaceRoutes());

  app.onError((error, c) => {
    // Routes raise these deliberately and carry their own response with them.
    if (error instanceof HTTPException) return error.getResponse();

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
