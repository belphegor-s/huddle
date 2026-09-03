import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../context.js';
import type { ApiEnv } from './env.js';
import { authCallbackRoutes, authRoutes } from './routes/auth.js';
import { channelRoutes } from './routes/channels.js';
import { fileRoutes } from './routes/files.js';
import { messageRoutes } from './routes/messages.js';
import { pushRoutes } from './routes/push.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { withSession } from './session.js';

export type { ApiContext, ApiEnv } from './env.js';
export {
  CLEARED_SESSION_COOKIE,
  endSession,
  SESSION_COOKIE,
  sessionFromRequest,
  sessionTokenFrom,
  startSession,
} from './session.js';

/**
 * The whole HTTP surface. It is a plain Hono app over Fetch types, so the same
 * object is served by the Node process in production and mounted directly in
 * tests without a socket.
 */
export function createApi(app: AppContext): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>();

  api.use('*', async (c, next) => {
    c.set('app', app);
    await next();
  });

  api.use('/api/*', withSession);
  api.use('/auth/*', withSession);

  api.get('/api/health', (c) =>
    c.json({
      ok: true,
      time: app.now(),
      ai: app.ai.available,
      push: app.push.available,
    }),
  );

  api.route('/api/auth', authRoutes());
  api.route('/api', workspaceRoutes());
  api.route('/api', channelRoutes());
  api.route('/api', messageRoutes());
  api.route('/api', fileRoutes());
  api.route('/api', pushRoutes());
  api.route('/auth', authCallbackRoutes());

  api.onError((error, c) => {
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

  api.notFound((c) => c.json({ error: 'not_found' }, 404));

  return api;
}
