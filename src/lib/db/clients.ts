import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
// Value + type live in a PLAIN module: a "use client" component imports the
// function, and anything reachable from this file drags in next/headers.
import type { ClientVisibility } from "@/lib/clients/visibility";
import { addClientMember } from "@/lib/db/client-members";

// New clients default to PRIVATE only when the firm opted in
// (firms.clients_private_by_default, 0830) AND the creator is an OWNER — staff
// can't set is_private (the clients_all WITH CHECK would reject the insert), and
// "clients private by default" is the OWNER's posture. Migration-gated + fails
// open: if the column/role isn't there yet, this is false = public = today's
// behavior (select('*') never throws on the absent column). Reads through the
// request-cached getCurrentUser/getCurrentFirm, so it costs nothing on a
// request that already resolved them.
async function newClientDefaultsPrivate(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return false;
  const firm = await getCurrentFirm();
  return (firm as { clients_private_by_default?: boolean } | null)
    ?.clients_private_by_default === true;
}

async function currentFirmId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (!user.firm_id) throw new Error("No firm for user");
  return user.firm_id;
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
  // Optional portal access code (migration 1180). When true, this client's
  // portal link asks for a 6-digit code before it shows anything. Default false
  // for every client, and possibly undefined at runtime until 1180 is applied —
  // ALWAYS read it as `client.portal_pin_enabled === true`, so a missing column
  // means "no gate" rather than locking a client out of their own portal.
  // The code itself is deliberately NOT on this type: portal_pin_encrypted and
  // portal_pin_salt are server-only and must never reach a browser. See
  // src/lib/portal/gate.ts.
  portal_pin_enabled: boolean;
  // How far this client is discoverable (migration 1280).
  //
  //   "members"  only owners, the assignee and people on its list see it at
  //              all — the 1240 behaviour, and the default for every row.
  //   "listed"   the whole firm sees the ROW, so they know it exists and who
  //              to ask. The work stays shut: engagement, document and payment
  //              policies gate on membership, not on this.
  //
  // Possibly undefined at runtime until 1280 is applied — ALWAYS read it
  // through clientVisibility() below, which resolves anything unrecognised to
  // "members". Fail CLOSED here, unlike is_private: a read blip must not turn
  // a members-only client into a firm-wide directory entry.
  visibility?: ClientVisibility | null;
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
  return (await getAuthUser())?.id ?? null;
}

export type ClientFilters = {
  search?: string;
  type?: "individual" | "business" | "all";
  includeArchived?: boolean;
};

// The real fetch, React.cache'd on PRIMITIVE keys — cache() compares object
// arguments by reference, so caching the public function directly would never
// dedupe two call sites passing equal-looking filter objects. Several pages
// read the client list more than once per render (the table + a name map, or
// a page plus the worklist loader); this collapses identical reads to one
// query per request. Every caller is a page-render read (verified: nothing
// creates a client and re-lists within one request).
const listClientsCached = cache(async function _listClients(
  search: string,
  type: "individual" | "business" | "all",
  includeArchived: boolean,
): Promise<Client[]> {
  const supabase = await getServerSupabase();
  let query = supabase.from("clients").select("*");

  if (!includeArchived) {
    query = query.is("archived_at", null);
  }
  if (type !== "all") {
    query = query.eq("type", type);
  }
  if (search) {
    query = query.or(`display_name.ilike.%${search}%,email.ilike.%${search}%`);
  }
  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Client[];
});

export async function listClients(filters: ClientFilters = {}): Promise<
  Client[]
> {
  return listClientsCached(
    filters.search?.trim() ?? "",
    filters.type ?? "all",
    filters.includeArchived === true,
  );
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
    is_private: await newClientDefaultsPrivate(),
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
  const created = data as Client;

  // EVERY new client starts with somebody on its team.
  //
  // The 1210 backfill fixed history; this is the ongoing leak it did not close.
  // Once slice 3 makes membership the thing that grants sight, a client created
  // with an empty team is a client nobody is on — and the person who just typed
  // its name would be the first to lose it. The creator is already recorded as
  // assigned_user_id above; this makes them a member too, which is the field
  // that will still mean something afterwards.
  //
  // Best-effort: a failure here must never lose the client that was just
  // created successfully. Pre-1210 it no-ops.
  if (owner) {
    try {
      await addClientMember({
        firmId: firm_id,
        clientId: created.id,
        userId: owner,
        actorId: owner,
      });
    } catch (err) {
      console.error("[clients] could not seed the client's team:", err);
    }
  }
  return created;
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
  const isPrivate = await newClientDefaultsPrivate();
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

/**
 * The middle privacy level (migration 1280): whether the whole firm can see
 * this client's ROW.
 *
 * Deliberately a SEPARATE writer from setClientPrivacy rather than another
 * argument on it. They answer different questions — is_private decides who may
 * WRITE the row, visibility decides who may SEE it — and the two have already
 * been confused once by living on the same menu.
 *
 * "unavailable" when 1280 is unapplied, so the caller can say so plainly
 * instead of reporting a generic failure.
 */
export async function setClientVisibility(
  clientId: string,
  visibility: ClientVisibility,
  firmId: string,
): Promise<{ ok: boolean; error?: "update_failed" | "unavailable" }> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ visibility })
    .eq("id", clientId)
    .eq("firm_id", firmId);
  if (error) {
    if (isMissingColumn(error)) return { ok: false, error: "unavailable" };
    console.error("[clients] set visibility failed:", error.message);
    return { ok: false, error: "update_failed" };
  }
  return { ok: true };
}
