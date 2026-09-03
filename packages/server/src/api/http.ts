import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodType } from 'zod';
import type { ApiContext } from './env.js';

/**
 * Domain errors are string literals, so the whole mapping from failure to
 * status code lives here rather than being restated in every route.
 *
 * `not_a_member` answers 404 on purpose. Telling a stranger that a workspace
 * exists but is closed to them is itself a leak.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  not_a_member: 404,
  not_found: 404,
  invalid_invite: 404,
  forbidden: 403,
  unauthorized: 401,
  slug_taken: 409,
  name_taken: 409,
  archived: 409,
  too_large: 413,
  unavailable: 503,
  expired: 410,
  used_up: 410,
  rate_limited: 429,
  invalid_token: 400,
  invalid: 400,
};

export function failure(c: ApiContext, error: string): Response {
  return c.json({ error }, STATUS[error] ?? 500);
}

export async function jsonBody<S extends ZodType>(c: ApiContext, schema: S): Promise<S['_output']> {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new HTTPException(400, { res: c.json({ error: 'invalid', issues }, 400) });
  }

  return parsed.data;
}
