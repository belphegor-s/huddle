import { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the built client. Everything Vite emits under /assets carries a
 * content hash in its name, so it is safe to cache forever, while the entry
 * documents must never be cached or a deploy would not reach anyone.
 *
 * A path with no file behind it falls through to the SPA shell, because the
 * client owns routing. That shell is a different document from the prerendered
 * landing page: serving the landing page for /w/acme would hydrate against the
 * wrong route and blank the screen.
 */
export function staticFiles(dir: string): Hono {
  const routes = new Hono();
  const base = resolve(dir);

  routes.get('*', async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    const candidates = [
      path,
      path.endsWith('/') ? `${path}index.html` : null,
      '/__spa-fallback.html',
      '/index.html',
    ];

    for (const candidate of candidates) {
      const file = candidate === null ? null : await send(base, candidate);
      if (file) return file;
    }

    return c.notFound();
  });

  return routes;
}

async function send(base: string, path: string): Promise<Response | null> {
  // A request for ../../etc/passwd must not escape the build directory.
  const target = resolve(join(base, normalize(path)));
  if (target !== base && !target.startsWith(base + sep)) return null;

  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) return null;

  const extension = extname(target);
  const immutable = path.startsWith('/assets/');

  return new Response(Readable.toWeb(createReadStream(target)) as ReadableStream, {
    headers: {
      'content-type': TYPES[extension] ?? 'application/octet-stream',
      'content-length': String(info.size),
      'cache-control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, must-revalidate',
    },
  });
}
