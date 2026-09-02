import type { User } from '@huddle/core';
import type { Context } from 'hono';
import type { AppContext } from '../context.js';

export interface ApiEnv {
  Variables: {
    app: AppContext;
    /** Present only after `withSession` has run and found a live session. */
    user: User | null;
    sessionToken: string | null;
  };
}

export type ApiContext = Context<ApiEnv>;

/**
 * Rate limiting and audit both need a stable caller identity. A reverse proxy
 * in front of the app sets these, and neither is trusted for anything but
 * bucketing.
 */
export function clientIp(c: ApiContext): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('x-real-ip') || 'unknown';
}

/** The origin this request arrived on, so magic links point back to it. */
export function appUrl(c: ApiContext): string {
  return c.var.app.config.publicUrl || new URL(c.req.url).origin;
}
