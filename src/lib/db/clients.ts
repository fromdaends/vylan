import { getServerSupabase } from "@/lib/supabase/server";

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
};

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
  const { data, error } = await supabase
    .from("clients")
    .insert({
      type: input.type,
      display_name: input.display_name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      locale: input.locale,
      external_ref: input.external_ref ?? null,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Client;
}

export async function bulkCreateClients(
  inputs: ClientInput[],
): Promise<{ created: number }> {
  if (inputs.length === 0) return { created: 0 };
  const supabase = await getServerSupabase();
  const rows = inputs.map((i) => ({
    type: i.type,
    display_name: i.display_name,
    email: i.email ?? null,
    phone: i.phone ?? null,
    locale: i.locale,
    external_ref: i.external_ref ?? null,
    notes: i.notes ?? null,
  }));
  const { error, count } = await supabase
    .from("clients")
    .insert(rows, { count: "exact" });
  if (error) throw error;
  return { created: count ?? rows.length };
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
