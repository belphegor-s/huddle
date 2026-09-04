import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Where the API is during development, when it is a second process.
 *
 * `PORT` is read from the same `.env` the server reads, so moving off 3000
 * because something else already has it takes one edit rather than two that
 * have to agree. Getting it wrong is otherwise silent: the proxy keeps
 * answering, with nothing behind it.
 */
function apiUrl(mode: string): string {
  if (process.env.HUDDLE_API_URL) return process.env.HUDDLE_API_URL;

  const env = loadEnv(mode, ROOT, '');
  return `http://localhost:${env.PORT || '3000'}`;
}

export default defineConfig(({ mode }) => {
  const target = apiUrl(mode);

  return {
    plugins: [tailwindcss(), reactRouter()],
    server: {
      // In development the app and the API run as two processes. In production
      // they are one origin, so nothing here has a production equivalent.
      proxy: {
        '/api': { target, changeOrigin: true, ws: true },
        '/auth': { target, changeOrigin: true },
      },
    },
  };
});
