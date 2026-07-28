import type { Me, UpdateProfileInput, User } from '@huddle/core';
import { users } from '@huddle/db';
import { eq } from 'drizzle-orm';
import type { Ports } from '../ports/index.js';
import { listWorkspaces } from './workspaces.js';

export type ProfileDeps = Pick<Ports, 'db' | 'clock'>;

/** Everything the client needs on boot: who you are and where you can go. */
export async function describeMe(deps: ProfileDeps, user: User): Promise<Me> {
  return { user, workspaces: await listWorkspaces(deps, user.id) };
}

export async function updateProfile(
  deps: ProfileDeps,
  input: { userId: string; patch: UpdateProfileInput },
): Promise<User | null> {
  const patch = definedOnly(input.patch);
  if (Object.keys(patch).length === 0) {
    const current = await deps.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    return current[0] ?? null;
  }

  const updated = await deps.db
    .update(users)
    .set(patch)
    .where(eq(users.id, input.userId))
    .returning();

  return updated[0] ?? null;
}

/**
 * An absent key means "leave it alone" while an explicit null means "clear
 * it", so undefined values must not reach the update or they would blank a
 * column the caller never mentioned.
 */
function definedOnly(patch: UpdateProfileInput): Partial<UpdateProfileInput> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}
