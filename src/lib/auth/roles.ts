// Role helpers for the team / multi-user feature.
//
// Two roles only: 'owner' (full access incl. billing, firm settings, team
// management) and 'staff' (full PRODUCT access, locked out of firm-admin). The
// role lives on users.role (since 0001); this module is the single place that
// reads it for access decisions, so enforcement stays consistent across the
// server actions + route handlers that call requireRole (Phase 4).

import { getCurrentUser } from "@/lib/db/users";

export type Role = "owner" | "staff";

export class RoleError extends Error {
  readonly required: Role;
  constructor(required: Role) {
    super(`This action requires the "${required}" role`);
    this.name = "RoleError";
    this.required = required;
  }
}

// PURE. Does `current` satisfy a requirement of `required`? With only two roles
// and owner being a superset of staff in capability, requiring 'owner' admits
// owners only; requiring 'staff' admits any signed-in member.
export function roleSatisfies(
  current: Role | null | undefined,
  required: Role,
): boolean {
  if (!current) return false;
  if (required === "staff") return true; // any authenticated member
  return current === "owner";
}

export async function getCurrentUserRole(): Promise<Role | null> {
  const user = await getCurrentUser();
  return user?.role ?? null;
}

// Throws RoleError when the caller lacks the required role. Callers (server
// actions / route handlers) translate RoleError into a friendly 403 (Phase 4).
export async function requireRole(role: "owner"): Promise<void> {
  const current = await getCurrentUserRole();
  if (!roleSatisfies(current, role)) throw new RoleError(role);
}
