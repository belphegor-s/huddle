import type { User } from '@huddle/core';
import type { Ports } from '@huddle/domain';
import type { Context } from 'hono';

export interface ApiEnv {
  Variables: {
    ports: Ports;
    /** Present only after `withSession` has run and found a live session. */
    user: User | null;
    sessionToken: string | null;
  };
}

export type ApiContext = Context<ApiEnv>;

/**
 * Rate limiting and audit both need a stable caller identity. Cloudflare sets
 * the first header, reverse proxies in front of the Node build set the
 * second, and neither is trusted for anything but bucketing.
 */
export function clientIp(c: ApiContext): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return c.req.header('cf-connecting-ip') ?? (forwarded || 'unknown');
}

/** The origin this request arrived on, so magic links point back to it. */
export function appUrl(c: ApiContext): string {
  return new URL(c.req.url).origin;
}
