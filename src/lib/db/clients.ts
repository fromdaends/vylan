import { getServerSupabase } from "@/lib/supabase/server";

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
  // fields. Both sets of columns are migration-gated (0210 owner, 0220 profile),
  // so degrade progressively if a migration isn't applied yet: full -> owner
  // only -> base. Creation never breaks; the gated values just fill in once the
  // migrations land.
  const withOwner = { ...base, assigned_user_id: owner };
  const withProfile = {
    ...withOwner,
    province: input.province ?? null,
    timezone: input.timezone ?? null,
    industry: input.industry ?? null,
  };
  let { data, error } = await supabase
    .from("clients")
    .insert(withProfile)
    .select("*")
    .single();
  if (error && isMissingColumn(error)) {
    ({ data, error } = await supabase
      .from("clients")
      .insert(withOwner)
      .select("*")
      .single());
    if (error && isMissingColumn(error)) {
      ({ data, error } = await supabase
        .from("clients")
        .insert(base)
        .select("*")
        .single());
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

  // Imported clients belong to the importer. Same pre-0210 fallback as
  // createClient: retry without the owner column if it doesn't exist yet.
  let { error, count } = await supabase
    .from("clients")
    .insert(
      base.map((r) => ({ ...r, assigned_user_id: owner })),
      { count: "exact" },
    );
  if (error && isMissingColumn(error)) {
    ({ error, count } = await supabase
      .from("clients")
      .insert(base, { count: "exact" }));
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
