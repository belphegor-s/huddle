import { err, ok, type Result, type Role } from '@huddle/core';
import { memberships } from '@huddle/db';
import { and, eq } from 'drizzle-orm';
import type { Database } from './ports/database.js';

/**
 * The only tenant boundary in the codebase. Every read and every write that
 * touches workspace data goes through here first, so isolation can be audited
 * by reading one file rather than trusting every query author.
 */

const RANK: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export interface Member {
  workspaceId: string;
  userId: string;
  role: Role;
}

export type AccessError = 'not_a_member' | 'forbidden';

export async function requireMember(
  db: Database,
  input: { workspaceId: string; userId: string; minimumRole?: Role },
): Promise<Result<Member, AccessError>> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId)),
    )
    .limit(1);

  const found = rows[0];
  if (!found) return err('not_a_member');

  if (RANK[found.role] < RANK[input.minimumRole ?? 'guest']) return err('forbidden');

  return ok({ workspaceId: input.workspaceId, userId: input.userId, role: found.role });
}

export function outranks(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
