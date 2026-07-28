/**
 * Domain boundaries return a Result rather than throwing, so a caller has to
 * handle the failure the type system already told it about. Exceptions stay
 * for the genuinely exceptional: a database that will not answer, a binding
 * that is missing.
 *
 * Error values are string literals, not classes, because they cross the
 * Durable Object RPC boundary and end up in JSON responses either way.
 */
export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends string>(error: E): Result<never, E> {
  return { ok: false, error };
}
