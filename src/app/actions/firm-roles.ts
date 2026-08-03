"use server";

// Creating firm roles and handing them out.
//
// Owner-only via team.manage, for every write — and once a role can carry
// capabilities that gate is load bearing: whoever edits roles decides what
// everyone wearing them may do. The same reason a Discord server does not let
// every member edit its roles.
//
// This file exports async functions ONLY: a "use server" module with a sync
// export typechecks, lints, passes every test, and then fails the production
// build naming something else entirely.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import {
  createFirmRole,
  updateFirmRole,
  deleteFirmRole,
  setUserRole,
  setRoleCapabilities,
  FirmRolesUnsupportedError,
} from "@/lib/db/firm-roles";
import { isGrantable } from "@/lib/auth/grantable";
import { normalizeRoleName, toRoleColor } from "@/lib/roles/palette";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";
import { getServiceRoleSupabase } from "@/lib/supabase/server";

export type RoleActionResult = {
  ok: boolean;
  /** Set when database update 1260 has not been applied yet. */
  needsMigration?: boolean;
  error?:
    | "no_session"
    | "not_allowed"
    | "bad_name"
    | "duplicate"
    | "not_found"
    | "owner_role"
    | "failed";
};

/**
 * Is this the automatic Owner role (1290)?
 *
 * Three writes must refuse it, and each for its own reason rather than a
 * blanket "it is special":
 *
 *   delete           — every firm has exactly one, maintained by trigger, and
 *                      the trigger would simply put it back
 *   set capabilities — an owner gets everything from users.role, so a switch
 *                      here is a control that changes nothing
 *   set membership   — the trigger owns it; a hand edit would be reverted the
 *                      next time anybody's rank was touched
 *
 * Renaming it and recolouring it are ALLOWED. Those are cosmetic and a firm
 * that would rather call it "Partner" should be able to.
 *
 * Reads the flag through the service-role client so an unapplied 1290 (no
 * column) answers false and everything behaves exactly as it did before.
 */
async function isOwnerRole(roleId: string, firmId: string): Promise<boolean> {
  const admin = getServiceRoleSupabase();
  const { data, error } = await admin
    .from("firm_roles")
    .select("is_owner_role")
    .eq("id", roleId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) return false;
  return (data as { is_owner_role?: boolean } | null)?.is_owner_role === true;
}

async function guard() {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { error: "no_session" as const };
  if (!can(user, "team.manage")) return { error: "not_allowed" as const };
  return { user, firm };
}

// Postgres reports the unique index on (firm_id, lower(name)) as 23505. Caught
// by code rather than by matching the message, which is localised on some
// deployments and would make this silently stop working.
function isDuplicate(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

export async function createRoleAction(input: {
  name: string;
  color: string;
}): Promise<RoleActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  const name = normalizeRoleName(input.name);
  if (!name) return { ok: false, error: "bad_name" };

  try {
    await createFirmRole({
      firmId: g.firm.id,
      name,
      color: toRoleColor(input.color),
      actorId: g.user.id,
    });
  } catch (err) {
    if (err instanceof FirmRolesUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    if (isDuplicate(err)) return { ok: false, error: "duplicate" };
    console.error("[roles] create failed:", err);
    return { ok: false, error: "failed" };
  }

  try {
    await logUserActivity(g.firm.id, null, "firm_role_created", { name });
  } catch (err) {
    console.error("[roles] audit log failed (role created):", err);
  }
  revalidateAllLocales("/settings/team");
  return { ok: true };
}

export async function updateRoleAction(input: {
  roleId: string;
  name: string;
  color: string;
}): Promise<RoleActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  const name = normalizeRoleName(input.name);
  if (!name) return { ok: false, error: "bad_name" };

  try {
    await updateFirmRole({
      firmId: g.firm.id,
      roleId: input.roleId,
      name,
      color: toRoleColor(input.color),
    });
  } catch (err) {
    if (err instanceof FirmRolesUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    if (isDuplicate(err)) return { ok: false, error: "duplicate" };
    console.error("[roles] update failed:", err);
    return { ok: false, error: "failed" };
  }
  revalidateAllLocales("/settings/team");
  return { ok: true };
}

export async function deleteRoleAction(input: {
  roleId: string;
}): Promise<RoleActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  if (await isOwnerRole(input.roleId, g.firm.id)) {
    return { ok: false, error: "owner_role" };
  }

  try {
    // Assignments go with it (on delete cascade), so nobody is left wearing a
    // badge that no longer exists.
    await deleteFirmRole({ firmId: g.firm.id, roleId: input.roleId });
  } catch (err) {
    if (err instanceof FirmRolesUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    console.error("[roles] delete failed:", err);
    return { ok: false, error: "failed" };
  }

  try {
    await logUserActivity(g.firm.id, null, "firm_role_deleted", {
      role_id: input.roleId,
    });
  } catch (err) {
    console.error("[roles] audit log failed (role deleted):", err);
  }
  revalidateAllLocales("/settings/team");
  return { ok: true };
}

export async function setRoleCapabilitiesAction(input: {
  roleId: string;
  capabilities: string[];
}): Promise<RoleActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  if (await isOwnerRole(input.roleId, g.firm.id)) {
    return { ok: false, error: "owner_role" };
  }

  // Narrowed to the VETTED list, not merely to "is a capability". The browser
  // sends this, and the difference matters: team.manage is a real capability
  // and handing it out through a role would route around every reason it is
  // owner-only. Anything not on the list is dropped silently — the request is
  // not honoured, and it is not worth an error message either.
  const capabilities = [...new Set(input.capabilities.filter(isGrantable))];

  try {
    await setRoleCapabilities({
      firmId: g.firm.id,
      roleId: input.roleId,
      capabilities,
    });
  } catch (err) {
    if (err instanceof FirmRolesUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    console.error("[roles] capabilities update failed:", err);
    return { ok: false, error: "failed" };
  }

  try {
    await logUserActivity(g.firm.id, null, "firm_role_permissions_changed", {
      role_id: input.roleId,
      capabilities,
    });
  } catch (err) {
    console.error("[roles] audit log failed (permissions changed):", err);
  }
  revalidateAllLocales("/settings/team");
  return { ok: true };
}

export async function setUserRoleAction(input: {
  userId: string;
  roleId: string;
  on: boolean;
}): Promise<RoleActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  if (await isOwnerRole(input.roleId, g.firm.id)) {
    return { ok: false, error: "owner_role" };
  }

  // The target must be in the caller's own firm. The service-role write below
  // does not enforce that, which is exactly why it is checked here.
  const admin = getServiceRoleSupabase();
  const { data: person } = await admin
    .from("users")
    .select("id, firm_id")
    .eq("id", input.userId)
    .maybeSingle();
  if (!person || person.firm_id !== g.firm.id) {
    return { ok: false, error: "not_found" };
  }

  try {
    await setUserRole({
      firmId: g.firm.id,
      userId: input.userId,
      roleId: input.roleId,
      on: input.on,
      actorId: g.user.id,
    });
  } catch (err) {
    if (err instanceof FirmRolesUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    console.error("[roles] assign failed:", err);
    return { ok: false, error: "failed" };
  }

  revalidateAllLocales(`/settings/team/${input.userId}`);
  revalidateAllLocales("/settings/team");
  return { ok: true };
}
