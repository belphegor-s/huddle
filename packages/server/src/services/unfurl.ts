import { err, hashToken, ok, ulid, type LinkPreview, type Result } from '@huddle/core';
import { files } from '@huddle/db';
import type { AppContext } from '../context.js';
import { RefusedError, safeFetch } from '../net/safe-fetch.js';
import { requireMember, type AccessError } from './access.js';

export type UnfurlError = AccessError | 'not_previewable' | 'rate_limited';

const HTML_BYTES = 512 * 1024;
const IMAGE_BYTES = 3 * 1024 * 1024;
const CACHE_SECONDS = 7 * 24 * 60 * 60;
const MISS_CACHE_SECONDS = 60 * 60;
const MINUTE_SECONDS = 60;
const UNFURLS_PER_MINUTE = 30;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

/**
 * Reads a link so the client never has to.
 *
 * The privacy rule forbids the client making a third party request, and an
 * `<img>` pointing at someone else's CDN is exactly that: it leaks every
 * reader's address and user agent to whoever was linked. So the server fetches
 * the page, and if there is a preview image it copies it into this
 * deployment's own bucket. Nothing in a rendered message points off site.
 */
export async function unfurlLink(
  ctx: AppContext,
  input: { workspaceId: string; userId: string; url: string },
): Promise<Result<LinkPreview | null, UnfurlError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err(member.error);

  const key = `unfurl:${input.workspaceId}:${await hashToken(input.url)}`;
  const cached = await ctx.kv.get(key);
  if (cached !== null) return ok(parseCached(cached));

  const rate = await ctx.kv.increment(`rl:unfurl:${input.userId}`, MINUTE_SECONDS);
  if (rate > UNFURLS_PER_MINUTE) return err('rate_limited');

  const preview = await read(ctx, input);

  // A miss is cached too, for less time. Without it, a message linking to
  // something unreachable re-fetches on every render, for everyone.
  await ctx.kv.set(
    key,
    JSON.stringify(preview),
    preview === null ? MISS_CACHE_SECONDS : CACHE_SECONDS,
  );

  return ok(preview);
}

async function read(
  ctx: AppContext,
  input: { workspaceId: string; userId: string; url: string },
): Promise<LinkPreview | null> {
  let page;
  try {
    page = await safeFetch(input.url, { maxBytes: HTML_BYTES, truncate: true });
  } catch (error) {
    if (error instanceof RefusedError) return null;
    throw error;
  }

  if (!page.contentType.startsWith('text/html')) return null;

  const html = page.body.toString('utf8');
  const meta = readMeta(html);
  const title = meta.get('og:title') ?? meta.get('twitter:title') ?? readTitle(html);
  if (!title) return null;

  const imageSource = meta.get('og:image') ?? meta.get('twitter:image');
  const image =
    imageSource === undefined
      ? null
      : await mirrorImage(ctx, input, new URL(imageSource, page.url).toString());

  return {
    url: input.url,
    title: clamp(title, 160),
    description: clamp(meta.get('og:description') ?? meta.get('description') ?? '', 300) || null,
    siteName: clamp(meta.get('og:site_name') ?? new URL(page.url).hostname, 80),
    imageUrl: image,
  };
}

/**
 * Copies a preview image into this deployment's bucket. Failure is not an
 * error: a preview without a picture is still a preview.
 */
async function mirrorImage(
  ctx: AppContext,
  input: { workspaceId: string; userId: string },
  source: string,
): Promise<string | null> {
  try {
    const response = await safeFetch(source, { maxBytes: IMAGE_BYTES, accept: 'image/*' });
    if (!IMAGE_TYPES.has(response.contentType)) return null;

    const now = ctx.now();
    const id = ulid(now);
    const storageKey = `${input.workspaceId}/previews/${id}`;

    await ctx.blobs.put(storageKey, response.body, response.contentType);

    await ctx.db.insert(files).values({
      id,
      workspaceId: input.workspaceId,
      uploaderId: input.userId,
      storageKey,
      name: 'preview',
      mimeType: response.contentType,
      size: response.body.byteLength,
      width: null,
      height: null,
      durationMs: null,
      peaks: null,
      createdAt: now,
    });

    return `/api/files/${id}`;
  } catch {
    return null;
  }
}

const META_TAG = /<meta\s+[^>]*>/gi;
const PROPERTY = /(?:property|name)\s*=\s*["']([^"']+)["']/i;
const CONTENT = /content\s*=\s*["']([^"']*)["']/i;

/** A regex reader, not a parser: only five known keys are ever looked at. */
export function readMeta(html: string): Map<string, string> {
  const found = new Map<string, string>();

  for (const tag of html.matchAll(META_TAG)) {
    const raw = tag[0];
    const key = PROPERTY.exec(raw)?.[1]?.toLowerCase();
    const value = CONTENT.exec(raw)?.[1];
    if (key && value && !found.has(key)) found.set(key, decodeEntities(value));
  }

  return found;
}

export function readTitle(html: string): string | null {
  const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1];
  return title ? decodeEntities(title.trim()) : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) => {
      const named = ENTITIES[name.toLowerCase()];
      if (named !== undefined) return named;

      const numeric = /^#(\d+)$/.exec(name);
      return numeric?.[1] ? String.fromCodePoint(Number(numeric[1])) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function parseCached(raw: string): LinkPreview | null {
  try {
    return JSON.parse(raw) as LinkPreview | null;
  } catch {
    return null;
  }
}
