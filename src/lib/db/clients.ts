import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

// New clients default to PRIVATE only when the firm opted in
// (firms.clients_private_by_default, 0830) AND the creator is an OWNER — staff
// can't set is_private (the clients_all WITH CHECK would reject the insert), and
// "clients private by default" is the OWNER's posture. Migration-gated + fails
// open: if the column/role isn't there yet, this is false = public = today's
// behavior (select('*') never throws on the absent column).
async function newClientDefaultsPrivate(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data: u } = await supabase
    .from("users")
    .select("firm_id, role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!u || u.role !== "owner") return false;
  const { data: f } = await supabase
    .from("firms")
    .select("*")
    .eq("id", u.firm_id)
    .maybeSingle();
  return (f as { clients_private_by_default?: boolean } | null)
    ?.clients_private_by_default === true;
}

async function currentFirmId(): Promise<string> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not authenticated");
  const { data: u, error } = await supabase
    .from("users")
    .select("firm_id")
    .eq("id", auth.user.id)
    .single();
  if (error || !u?.firm_id) throw new Error("No firm for user");
  return u.firm_id as string;
}

export type Client = {
  id: string;
  firm_id: string;
  type: "individual" | "business";
  display_name: string;
  email: string | null;
  phone: string | null;
  locale: "fr" | "en";
  external_ref: string | null;
  notes: string | null;
  created_at: string;
  archived_at: string | null;
  // The firm member who owns this client (migration 0210). Accountability
  // only — clients stay firm-scoped/visible to all. Possibly undefined at
  // runtime until 0210 is applied to the remote DB; callers coalesce to null.
  assigned_user_id: string | null;
  // Profile fields (migration 0220). All optional; null = not specified.
  province: string | null;
  timezone: string | null;
  industry: string | null;
  // "Private to me" (migration 0810). When true, this client and everything
  // under it is hidden from STAFF and visible only to OWNERS — enforced in RLS,
  // not here. Possibly undefined at runtime until 0810 is applied to the remote
  // DB; ALWAYS read it as `client.is_private ?? false` (fail-open = "not
  // private" = visible, matching today's behavior — do NOT invert this to hide
  // clients on a transient read blip). Only owners can set it (RLS WITH CHECK).
  is_private: boolean;
};

// PostgREST raises PGRST204 ("column not found in schema cache") when asked to
// write a column it doesn't know about. We use this to make client writes safe
// to deploy BEFORE the gated migrations (0210 owner, 0220 profile fields) are
// applied to the remote DB: retry with fewer columns rather than 500ing. Once
// the migrations are applied, the first attempt succeeds and this never fires.
function isMissingColumn(
  error: { code?: string | null } | null,
): boolean {
  return error?.code === "PGRST204";
}

async function currentAuthUserId(): Promise<string | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export type ClientFilters = {
  search?: string;
  type?: "individual" | "business" | "all";
  includeArchived?: boolean;
};

export async function listClients(filters: ClientFilters = {}): Promise<
  Client[]
> {
  const supabase = await getServerSupabase();
  let query = supabase.from("clients").select("*");

  if (!filters.includeArchived) {
    query = query.is("archived_at", null);
  }
  if (filters.type && filters.type !== "all") {
    query = query.eq("type", filters.type);
  }
  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim();
    query = query.or(`display_name.ilike.%${s}%,email.ilike.%${s}%`);
  }
  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Client[];
}

export async function getClient(id: string): Promise<Client | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Client) ?? null;
}

export type ClientInput = {
  type: "individual" | "business";
  display_name: string;
  email?: string | null;
  phone?: string | null;
  locale: "fr" | "en";
  external_ref?: string | null;
  notes?: string | null;
  province?: string | null;
  timezone?: string | null;
  industry?: string | null;
};

export async function createClient(input: ClientInput): Promise<Client> {
  const supabase = await getServerSupabase();
  const firm_id = await currentFirmId();
  const owner = await currentAuthUserId();
  const base = {
    firm_id,
    type: input.type,
    display_name: input.display_name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    locale: input.locale,
    external_ref: input.external_ref ?? null,
    notes: input.notes ?? null,
  };

  // New clients belong to whoever creates them and carry the optional profile
  // fields + the "private by default" flag. Every gated column is migration-gated
  // (0210 owner, 0220 profile, 0810 is_private), so degrade INDEPENDENTLY, one
  // column-set per tier, so an unknown column never takes co-located data down
  // with it: full -> profile (drop is_private) -> owner (drop profile) -> base.
  // Creation never breaks; each gated value fills in once its migration lands.
  const withOwner = { ...base, assigned_user_id: owner };
  const withProfileNoPrivate = {
    ...withOwner,
    province: input.province ?? null,
    timezone: input.timezone ?? null,
    industry: input.industry ?? null,
  };
  const withProfile = {
    ...withProfileNoPrivate,
    // Honor the firm's "clients private by default" switch (owner-created only).
    is_private: await newClientDefaultsPrivate(supabase),
  };
  const insertClient = (row: object) =>
    supabase.from("clients").insert(row).select("*").single();
  let { data, error } = await insertClient(withProfile);
  if (error && isMissingColumn(error)) {
    ({ data, error } = await insertClient(withProfileNoPrivate));
    if (error && isMissingColumn(error)) {
      ({ data, error } = await insertClient(withOwner));
      if (error && isMissingColumn(error)) {
        ({ data, error } = await insertClient(base));
      }
    }
  }
  if (error) throw error;
  return data as Client;
}

export async function bulkCreateClients(
  inputs: ClientInput[],
): Promise<{ created: number }> {
  if (inputs.length === 0) return { created: 0 };
  const supabase = await getServerSupabase();
  const firm_id = await currentFirmId();
  const owner = await currentAuthUserId();
  const base = inputs.map((i) => ({
    firm_id,
    type: i.type,
    display_name: i.display_name,
    email: i.email ?? null,
    phone: i.phone ?? null,
    locale: i.locale,
    external_ref: i.external_ref ?? null,
    notes: i.notes ?? null,
  }));

  // Imported clients belong to the importer and honor the firm's "clients private
  // by default" switch. Degrade one column-set per tier (like createClient), so an
  // unknown is_private (0810 pending) doesn't also drop owner attribution (0210):
  // owner+private -> owner only -> base.
  const isPrivate = await newClientDefaultsPrivate(supabase);
  const withOwner = base.map((r) => ({ ...r, assigned_user_id: owner }));
  let { error, count } = await supabase
    .from("clients")
    .insert(
      withOwner.map((r) => ({ ...r, is_private: isPrivate })),
      { count: "exact" },
    );
  if (error && isMissingColumn(error)) {
    ({ error, count } = await supabase
      .from("clients")
      .insert(withOwner, { count: "exact" }));
    if (error && isMissingColumn(error)) {
      ({ error, count } = await supabase
        .from("clients")
        .insert(base, { count: "exact" }));
    }
  }
  if (error) throw error;
  return { created: count ?? base.length };
}

export async function updateClient(
  id: string,
  patch: Partial<ClientInput>,
): Promise<Client> {
  const supabase = await getServerSupabase();
  let { data, error } = await supabase
    .from("clients")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  // If 0220 isn't applied yet, an edit including the profile fields fails on
  // the unknown column — retry without them so editing still works.
  if (error && isMissingColumn(error)) {
    const safe = { ...patch };
    delete safe.province;
    delete safe.timezone;
    delete safe.industry;
    ({ data, error } = await supabase
      .from("clients")
      .update(safe)
      .eq("id", id)
      .select("*")
      .single());
  }
  if (error) throw error;
  return data as Client;
}

export async function archiveClient(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreClient(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ archived_at: null })
    .eq("id", id);
  if (error) throw error;
}

// A client can be reassigned only to an ACTIVE member of the SAME firm. Pure so
// the server action can validate the target it just loaded without another DB
// round-trip (and so the rule is unit-testable). Mirrors the engagement
// reassignment guard in reassignEngagementAction.
export function canReceiveClientAssignment(
  target: { firm_id: string; deactivated_at: string | null } | null | undefined,
  firmId: string,
): boolean {
  return !!target && target.firm_id === firmId && !target.deactivated_at;
}

// Reassign a client's OWNER (accountability) to another firm member. Scoped to
// firmId so a client from another firm can never be touched even if a bad id is
// passed. assigned_user_id is migration-gated (0210): if the column isn't
// present yet the write surfaces as "unavailable" rather than a 500 — matching
// the progressive-degrade convention used by createClient/updateClient. Like
// engagement assignment, this is accountability only; clients stay firm-visible.
export async function reassignClient(
  clientId: string,
  assigneeId: string,
  firmId: string,
): Promise<{ ok: boolean; error?: "update_failed" | "unavailable" }> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ assigned_user_id: assigneeId })
    .eq("id", clientId)
    .eq("firm_id", firmId);
  if (error) {
    if (isMissingColumn(error)) return { ok: false, error: "unavailable" };
    console.error("[clients] reassign failed:", error.message);
    return { ok: false, error: "update_failed" };
  }
  return { ok: true };
}

// Set (or clear) a client's "Private to me" flag (migration 0810). Scoped to
// firmId so a bad id can never touch another firm's client. is_private is
// migration-gated: before 0810 is applied the column doesn't exist and the write
// surfaces as "unavailable" (PGRST204) rather than a 500 — the same
// progressive-degrade convention as reassignClient. The DB is the real gate:
// the clients_all RLS WITH CHECK arm rejects a non-owner trying to set it, and
// once the flag is on the row is invisible to staff. This is the write the owner
// toggle calls.
export async function setClientPrivacy(
  clientId: string,
  isPrivate: boolean,
  firmId: string,
): Promise<{ ok: boolean; error?: "update_failed" | "unavailable" }> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ is_private: isPrivate })
    .eq("id", clientId)
    .eq("firm_id", firmId);
  if (error) {
    if (isMissingColumn(error)) return { ok: false, error: "unavailable" };
    console.error("[clients] set privacy failed:", error.message);
    return { ok: false, error: "update_failed" };
  }
  return { ok: true };
}
