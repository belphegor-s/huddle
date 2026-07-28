import { createApi } from '@huddle/api';
import {
  createCloudflarePorts,
  R2BlobStore,
  type CloudflareBindings,
} from '@huddle/adapter-cloudflare';
import { createRequestHandler, RouterContextProvider } from 'react-router';
import { portsContext } from '../app/lib/ports';

export { ChannelRoom, RateCounter } from '@huddle/adapter-cloudflare';

const handler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

/**
 * Uploads and downloads bypass the shared API, because streaming a body into
 * R2 is the one thing that genuinely differs between platforms. Everything
 * else lives in packages/api and runs unchanged on Node.
 */
async function handleBlob(request: Request, env: CloudflareBindings): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/blobs\/(.+)$/.exec(url.pathname);
  if (!match?.[1]) return null;

  const key = decodeURIComponent(match[1]);
  const blobs = new R2BlobStore(env.BLOBS, env.PUBLIC_URL);

  if (request.method === 'PUT') {
    if (!request.body) return new Response('Missing body', { status: 400 });
    // Piped, never buffered, so a large file does not touch the 128MB limit.
    await blobs.put(
      key,
      request.body,
      request.headers.get('content-type') ?? 'application/octet-stream',
    );
    return new Response(null, { status: 204 });
  }

  if (request.method === 'GET') {
    const object = await blobs.getObject(key);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'private, max-age=31536000, immutable');
    return new Response(object.body, { headers });
  }

  return new Response('Method not allowed', { status: 405 });
}

export default {
  async fetch(request: Request, env: CloudflareBindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const ports = createCloudflarePorts(env, ctx);

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      const blobResponse = await handleBlob(request, env);
      if (blobResponse) return blobResponse;
      return createApi(ports).fetch(request);
    }

    // Loaders and actions get the ports directly rather than calling our own
    // API over HTTP. A same origin subrequest would be a second billed request
    // per render, and would land in the same use case anyway.
    const context = new RouterContextProvider();
    context.set(portsContext, ports);

    return handler(request, context);
  },
} satisfies ExportedHandler<CloudflareBindings>;
