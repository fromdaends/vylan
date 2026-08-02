import { getServerSupabase } from "@/lib/supabase/server";
import type {
  RelationshipScope,
  RelationshipType,
} from "@/lib/relationships/validate";

// One row of client_relationships (migration 1150). Firm-internal metadata
// linking two existing clients; never exposed to the portal. All reads here
// are RLS-scoped: firm isolation + the private-client cascade on both ends.
export type ClientRelationship = {
  id: string;
  firm_id: string;
  from_client_id: string;
  to_client_id: string;
  rel_type: RelationshipType;
  percentage: number | null;
  scopes: RelationshipScope[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_via: "manual" | "client_archived" | null;
};

// Every LIVE link touching one client, from either end. created_at order so
// the profile card's within-type ordering is stable ("first linked, first").
export async function listRelationshipsForClient(
  clientId: string,
): Promise<ClientRelationship[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("client_relationships")
    .select("*")
    .or(`from_client_id.eq.${clientId},to_client_id.eq.${clientId}`)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClientRelationship[];
}

export async function getRelationship(
  id: string,
): Promise<ClientRelationship | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("client_relationships")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ClientRelationship) ?? null;
}

// All of the firm's live links in one query — the clients list turns these
// into per-row indicators, so this must stay a single round-trip rather than
// one query per client. RLS scopes to the caller's firm (and hides links
// touching private clients from staff, which is exactly what the list should
// show them).
export async function listLiveRelationshipsForFirm(): Promise<
  ClientRelationship[]
> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("client_relationships")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClientRelationship[];
}

// Name/email/type for a set of related clients — the engagement header line
// ("Owned by …") and the scope warning need the OTHER end of each link
// without dragging in the whole clients list. RLS-scoped like every read here.
export async function listRelatedClientsBrief(ids: string[]): Promise<
  Array<{
    id: string;
    display_name: string;
    email: string | null;
    type: "individual" | "business";
  }>
> {
  if (ids.length === 0) return [];
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("id, display_name, email, type")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    display_name: string;
    email: string | null;
    type: "individual" | "business";
  }>;
}

export type RelationshipInsert = {
  firm_id: string;
  from_client_id: string;
  to_client_id: string;
  rel_type: RelationshipType;
  percentage: number | null;
  scopes: RelationshipScope[] | null;
  created_by: string | null;
};

export type RelationshipWriteResult =
  | { ok: true; relationship: ClientRelationship }
  | { ok: false; error: "duplicate" | "spouse_taken" | "rejected" };

// Postgres unique violation (the live-pair index) → "this link already exists".
function isUniqueViolation(error: { code?: string | null } | null): boolean {
  return error?.code === "23505";
}

// The 1150 guard trigger raises P0001 with a message naming the rule; the only
// one reachable through a validated payload is the one-spouse-per-individual
// rule (endpoint shapes are pre-validated in the action).
function isSpouseTaken(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  return error?.code === "P0001" && !!error.message?.includes("spouse");
}

export async function createRelationship(
  row: RelationshipInsert,
): Promise<RelationshipWriteResult> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("client_relationships")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "duplicate" };
    if (isSpouseTaken(error)) return { ok: false, error: "spouse_taken" };
    console.error("[relationships] create failed:", error.message);
    return { ok: false, error: "rejected" };
  }
  return { ok: true, relationship: data as ClientRelationship };
}

// Only the type-specific detail is editable (percentage / scopes). Changing
// endpoints or type is remove + re-add — one shape of edit keeps the audit
// trail legible.
export async function updateRelationshipDetail(
  id: string,
  patch: { percentage?: number | null; scopes?: RelationshipScope[] | null },
): Promise<RelationshipWriteResult> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("client_relationships")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) {
    console.error("[relationships] update failed:", error.message);
    return { ok: false, error: "rejected" };
  }
  return { ok: true, relationship: data as ClientRelationship };
}

export async function softDeleteRelationship(
  id: string,
): Promise<{ ok: boolean }> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("client_relationships")
    .update({ deleted_at: new Date().toISOString(), deleted_via: "manual" })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    console.error("[relationships] remove failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

// Restore a MANUALLY removed link (the undo toast). Rows hidden by a client
// archive are restored by the archive-cascade trigger when the client is
// restored, never from here. The guard trigger re-checks the spouse rule and
// the live-pair index re-checks duplicates, so a restore can conflict if an
// equivalent link was re-created in the meantime.
export async function restoreRelationship(
  id: string,
): Promise<RelationshipWriteResult> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("client_relationships")
    .update({ deleted_at: null, deleted_via: null })
    .eq("id", id)
    .eq("deleted_via", "manual")
    .select("*")
    .single();
  if (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "duplicate" };
    if (isSpouseTaken(error)) return { ok: false, error: "spouse_taken" };
    console.error("[relationships] restore failed:", error.message);
    return { ok: false, error: "rejected" };
  }
  return { ok: true, relationship: data as ClientRelationship };
}
