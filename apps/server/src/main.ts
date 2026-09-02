import { serve } from '@hono/node-server';
import { attachSocket, createApp, sessionFromRequest } from '@huddle/server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { staticFiles } from './static.js';

/**
 * The whole deployment: one process serving the client bundle, the API and the
 * WebSocket on a single port. Same origin means the session cookie works with
 * no CORS and no second hostname to configure.
 */
const app = await createApp({ clustered: process.env.HUDDLE_CLUSTER === 'true' });

const root = new Hono();
root.route('/', app.api);
if (app.config.webDir !== '') root.route('/', staticFiles(app.config.webDir));

const server = serve({ fetch: root.fetch, port: app.config.port }, (info) => {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'listening',
      port: info.port,
      url: app.config.publicUrl,
    }),
  );
});

/**
 * The upgrade is authenticated before the socket exists. A connection that
 * cannot name a live session is refused at the handshake rather than being
 * accepted and then policed frame by frame.
 */
const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', app.config.publicUrl);
  if (url.pathname !== '/api/realtime') {
    socket.destroy();
    return;
  }

  const asFetch = new Request(url, {
    headers: new Headers(request.headers as Record<string, string>),
  });

  void sessionFromRequest(app.ctx, asFetch)
    .then((user) => {
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      sockets.handleUpgrade(request, socket, head, (ws) => {
        attachSocket(app.ctx, ws, user.id);
      });
    })
    .catch(() => socket.destroy());
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown();
  });
}

async function shutdown(): Promise<void> {
  console.log(JSON.stringify({ level: 'info', event: 'shutting_down' }));
  sockets.close();
  server.close();
  await app.close();
  process.exit(0);
}
