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
};

// PostgREST raises PGRST204 (and names the column) when asked to write a column
// it doesn't know about. Used to make client creation safe to deploy BEFORE
// migration 0210 is applied to the remote DB: we retry the insert without the
// owner column rather than 500ing. Once 0210 is applied, the first attempt
// succeeds and this never fires.
function isMissingAssignedColumn(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    /assigned_user_id/i.test(error.message ?? "")
  );
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

  // New clients belong to whoever creates them. If 0210 isn't applied yet the
  // first insert fails on the unknown column; retry without it so creation
  // still works (the client is just unassigned until the migration lands).
  let { data, error } = await supabase
    .from("clients")
    .insert({ ...base, assigned_user_id: owner })
    .select("*")
    .single();
  if (error && isMissingAssignedColumn(error)) {
    ({ data, error } = await supabase
      .from("clients")
      .insert(base)
      .select("*")
      .single());
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
  if (error && isMissingAssignedColumn(error)) {
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
  const { data, error } = await supabase
    .from("clients")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
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
