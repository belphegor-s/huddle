import type { Role } from '@huddle/core';

const RANK: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

/**
 * The client copy of the server's rank check. It decides what to draw, never
 * what is allowed: the server runs the same comparison again on every call.
 */
export function outranksMember(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
