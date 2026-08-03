// Firm roles — the badges an owner defines and hands out.
//
// A role is a name, a colour, and optionally some capabilities. Grants are
// ADDITIVE on top of the person's preset and flow through the same resolver as
// everything else — see capabilitiesFor(). A role can never take anything away.
//
// READS DEGRADE, WRITES REFUSE, the same shape as month-close.ts and
// client-members.ts. Before 1260 is applied there is no table: a read returns
// "no roles", which is exactly what a firm that has never made one should see,
// and a write names the file to run instead of failing with a Postgres error.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { toRoleColor, type RoleColor } from "@/lib/roles/palette";

export type FirmRole = {
  id: string;
  name: string;
  color: RoleColor;
  /** What wearing this role grants. Narrowed to the vetted list on write. */
  capabilities: string[];
};

export class FirmRolesUnsupportedError extends Error {
  constructor() {
    super(
      "Roles need database update 1260. Run supabase/migrations/1260_firm_roles.sql, then try again.",
    );
    this.name = "FirmRolesUnsupportedError";
  }
}

function toRole(r: Record<string, unknown>): FirmRole | null {
  const id = typeof r.id === "string" ? r.id : null;
  const name = typeof r.name === "string" ? r.name : null;
  if (!id || !name) return null;
  return {
    id,
    name,
    color: toRoleColor(r.color),
    capabilities: Array.isArray(r.capabilities)
      ? r.capabilities.filter((c): c is string => typeof c === "string")
      : [],
  };
}

/** Every role the firm has defined, alphabetically — the order they are listed
 *  and picked in, which should not depend on when they happened to be made. */
export async function listFirmRoles(): Promise<FirmRole[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("firm_roles")
    .select("id, name, color, capabilities")
    .order("name", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? [])
    .map((r) => toRole(r as Record<string, unknown>))
    .filter((r): r is FirmRole => r !== null);
}

/**
 * Who holds what, keyed by user id.
 *
 * One query for the whole roster rather than one per person: a firm page that
 * fetched per row would open with a round trip per teammate before it drew
 * anything.
 */
export async function listRolesByUser(): Promise<Map<string, FirmRole[]>> {
  const out = new Map<string, FirmRole[]>();
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("user_firm_roles")
    .select("user_id, firm_roles(id, name, color, capabilities)");
  if (error) {
    if (isMissingSchema(error)) return out;
    throw error;
  }
  for (const row of data ?? []) {
    const r = row as { user_id?: unknown; firm_roles?: unknown };
    const userId = typeof r.user_id === "string" ? r.user_id : null;
    // PostgREST returns an embedded row as an object, or an array on some
    // relationship shapes. Handle both rather than assuming one.
    const embedded = Array.isArray(r.firm_roles) ? r.firm_roles[0] : r.firm_roles;
    const role = embedded ? toRole(embedded as Record<string, unknown>) : null;
    if (!userId || !role) continue;
    const list = out.get(userId);
    if (list) list.push(role);
    else out.set(userId, [role]);
  }
  // Same alphabetical order as the picker, so a person's badges do not shuffle
  // between the roster and their profile.
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ── Writes. Service-role, gated in the actions layer (team.manage). ──────────

export async function createFirmRole(input: {
  firmId: string;
  name: string;
  color: RoleColor;
  actorId?: string | null;
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  const { error } = await admin.from("firm_roles").insert({
    firm_id: input.firmId,
    name: input.name,
    color: input.color,
    created_by: input.actorId ?? null,
  });
  if (error) {
    if (isMissingSchema(error)) throw new FirmRolesUnsupportedError();
    throw error;
  }
}

export async function updateFirmRole(input: {
  firmId: string;
  roleId: string;
  name: string;
  color: RoleColor;
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  // Scoped to the firm as well as the id: the id came from a browser, and the
  // service-role client would happily rename another firm's role without this.
  const { error } = await admin
    .from("firm_roles")
    .update({ name: input.name, color: input.color })
    .eq("id", input.roleId)
    .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new FirmRolesUnsupportedError();
    throw error;
  }
}

/** Deleting a role takes its assignments with it (on delete cascade). */
export async function deleteFirmRole(input: {
  firmId: string;
  roleId: string;
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  const { error } = await admin
    .from("firm_roles")
    .delete()
    .eq("id", input.roleId)
    .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new FirmRolesUnsupportedError();
    throw error;
  }
}

export async function setUserRole(input: {
  firmId: string;
  userId: string;
  roleId: string;
  on: boolean;
  actorId?: string | null;
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  if (!input.on) {
    const { error } = await admin
      .from("user_firm_roles")
      .delete()
      .eq("user_id", input.userId)
      .eq("role_id", input.roleId)
      .eq("firm_id", input.firmId);
    if (error) {
      if (isMissingSchema(error)) throw new FirmRolesUnsupportedError();
      throw error;
    }
    return;
  }
  // Upsert on the primary key: giving somebody a role they already have is a
  // no-op rather than an error, which matters on a screen two people may have
  // open.
  const { error } = await admin.from("user_firm_roles").upsert(
    {
      user_id: input.userId,
      role_id: input.roleId,
      firm_id: input.firmId,
      assigned_by: input.actorId ?? null,
    },
    { onConflict: "user_id,role_id" },
  );
  if (error) {
    if (isMissingSchema(error)) throw new FirmRolesUnsupportedError();
    throw error;
  }
}

/** The role ids one person holds — for the assignment switches on their page. */
export async function listRoleIdsForUser(userId: string): Promise<Set<string>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("user_firm_roles")
    .select("role_id")
    .eq("user_id", userId);
  if (error) {
    if (isMissingSchema(error)) return new Set();
    throw error;
  }
  return new Set(
    (data ?? [])
      .map((r) => (r as { role_id?: unknown }).role_id)
      .filter((v): v is string => typeof v === "string"),
  );
}

/**
 * Everything this person's roles grant, unioned.
 *
 * Read once per request by getCurrentUser and handed to capabilitiesFor, so
 * every existing can() call site picks role grants up with no change at all.
 */
export async function roleCapabilitiesForUser(
  userId: string,
): Promise<string[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("user_firm_roles")
    .select("firm_roles(capabilities)")
    .eq("user_id", userId);
  if (error) {
    // Pre-1260 there are no roles, so nothing is granted — which is exactly
    // today's behaviour and the safe direction for a permission read.
    if (isMissingSchema(error)) return [];
    throw error;
  }
  const out = new Set<string>();
  for (const row of data ?? []) {
    const embedded = (row as { firm_roles?: unknown }).firm_roles;
    const role = Array.isArray(embedded) ? embedded[0] : embedded;
    const caps = (role as { capabilities?: unknown } | null)?.capabilities;
    if (!Array.isArray(caps)) continue;
    for (const c of caps) if (typeof c === "string") out.add(c);
  }
  return [...out];
}

/** Replace what a role grants. Narrowing happens in the action layer. */
export async function setRoleCapabilities(input: {
  firmId: string;
  roleId: string;
  capabilities: string[];
}): Promise<void> {
  const admin = getServiceRoleSupabase();
  const { error } = await admin
    .from("firm_roles")
    .update({ capabilities: input.capabilities })
    .eq("id", input.roleId)
    .eq("firm_id", input.firmId);
  if (error) {
    if (isMissingSchema(error)) throw new FirmRolesUnsupportedError();
    throw error;
  }
}
