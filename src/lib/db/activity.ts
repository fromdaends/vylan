import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";

export type ActivityActor = "user" | "client" | "system";

export type ActivityEntry = {
  id: string;
  firm_id: string;
  engagement_id: string | null;
  actor_type: ActivityActor;
  actor_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function listActivityForEngagement(
  engagementId: string,
  limit = 100,
): Promise<ActivityEntry[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ActivityEntry[];
}

// When the engagement's invoice was most recently waived/canceled, read from
// the permanent audit trail (the `invoice_waived` row logUserActivity writes at
// waive time). Used to time the header's transient "Payment canceled" chip: it
// shows only for a few minutes after the waive, then hides — while this audit
// row stays forever. Returns the ISO timestamp, or null if no waive is logged.
// RLS-scoped to the caller's firm, same as listActivityForEngagement. Degrades
// to null on any read error so the header never hard-fails.
// The handoff note from the most recent reassignment, with who wrote it and
// when.
//
// WHY THIS EXISTS: the note an accountant writes when passing work over ("vehicle
// log still missing, meals capped at 50%") was only ever stored in activity_log
// metadata and pushed into the assignee's notification. It was never rendered on
// the engagement, so the moment that notification was read the instructions were
// effectively gone — the person doing the work had nowhere to look them up.
//
// Only the LATEST matters: an earlier handoff's note describes a state of the
// work that has since moved on.
// Returns the writer's user id rather than a name: activity_log has no name
// column (actor_id is plain text), and every caller already holds the firm
// roster, so mapping id -> name there costs nothing and avoids a join here.
// Hits activity_log_engagement_idx (engagement_id, created_at desc).
export async function getLatestHandoffNote(engagementId: string): Promise<{
  note: string;
  actorId: string | null;
  at: string;
} | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("activity_log")
    .select("metadata, created_at, actor_id")
    .eq("engagement_id", engagementId)
    // Either event can carry the note: the reassignment itself (note typed
    // before confirming, the old flow) or a handoff note added afterwards from
    // the toast. Most recent wins, which is what makes a LATER bare
    // reassignment correctly clear a stale note instead of resurrecting it.
    .in("action", ["engagement_reassigned", "engagement_handoff_note"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    metadata: Record<string, unknown> | null;
    created_at: string;
    actor_id: string | null;
  };
  const note = row.metadata?.note;
  // A reassignment without a note is the common case — not an error.
  if (typeof note !== "string" || !note.trim()) return null;
  return { note: note.trim(), actorId: row.actor_id, at: row.created_at };
}

export async function getLatestInvoiceWaivedAt(
  engagementId: string,
): Promise<string | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("activity_log")
    .select("created_at")
    .eq("engagement_id", engagementId)
    .eq("action", "invoice_waived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data?.created_at as string | undefined) ?? null;
}

// Whether the engagement's invoice was waived within the last `windowMs`, plus
// the waive timestamp. Reads the clock HERE (a lib function) rather than in the
// server component, so the page render stays pure. Drives the header's transient
// "Payment canceled" chip.
export async function getRecentInvoiceCancel(
  engagementId: string,
  windowMs: number,
): Promise<{ canceledAt: string | null; recent: boolean }> {
  const canceledAt = await getLatestInvoiceWaivedAt(engagementId);
  const recent =
    canceledAt != null &&
    Date.now() - new Date(canceledAt).getTime() < windowMs;
  return { canceledAt, recent };
}

// REMOVED: EngagementContributor / summarizeContributors /
// listEngagementContributors — the "Worked on by" strip they fed. It listed
// every teammate who had touched a job, which is the same surveillance-of-your-
// own-colleagues object as the per-person activity feed the founder rejected,
// just scoped to one file instead of one person. Who is ACCOUNTABLE is the
// assignee, and that control sits right above where this used to render; who is
// LOOKING is answered live by presence, not by a permanent record of everyone
// who ever opened it. If it comes back, it belongs in the owner's audit log
// filtered by engagement, not on a page every teammate opens.

export type FirmActivityEntry = ActivityEntry & {
  engagement_title: string | null;
  client_id: string | null;
  client_display_name: string | null;
  actor_name: string | null;
};

// Firm-wide activity log for the security/audit view at /settings/audit.
// RLS scopes activity_log to the caller's firm. Optional filters:
//   - clientId: only rows whose engagement belongs to this client
//   - action:   only rows with this exact action string
//
// Enriches each row with the parent engagement title + client display
// name + actor user's display name so the audit table reads "who did
// what on which engagement for which client" without per-row lookups.
export async function listActivityForFirm(filters: {
  clientId?: string | null;
  action?: string | null;
  // Only this user's actions (actor_type 'user'). Powers the teammate profile's
  // "recent activity" feed.
  actorId?: string | null;
  limit?: number;
} = {}): Promise<FirmActivityEntry[]> {
  const supabase = await getServerSupabase();
  const limit = filters.limit ?? 300;

  // When filtering by client, resolve the client's engagements FIRST
  // and constrain activity_log to that engagement set. Doing the
  // client filter in-memory after the limit was wrong: a quiet client
  // with only old events could be hidden behind the firm's 300 most
  // recent rows and the page would show empty even though the data
  // exists. Pre-filtering also lets us spend the full row budget on
  // that one client.
  let scopedEngagementIds: string[] | null = null;
  if (filters.clientId) {
    const { data: engForClient, error: engErr } = await supabase
      .from("engagements")
      .select("id")
      .eq("client_id", filters.clientId);
    if (engErr) throw engErr;
    scopedEngagementIds = (engForClient ?? []).map((e) => e.id as string);
    // No engagements for this client → no activity, short-circuit.
    if (scopedEngagementIds.length === 0) return [];
  }

  let query = supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actorId) {
    query = query.eq("actor_type", "user").eq("actor_id", filters.actorId);
  }
  if (scopedEngagementIds) {
    query = query.in("engagement_id", scopedEngagementIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  const entries = (data ?? []) as ActivityEntry[];
  if (entries.length === 0) return [];

  const engagementIds = Array.from(
    new Set(
      entries
        .map((e) => e.engagement_id)
        .filter((id): id is string => id != null),
    ),
  );
  const engagementRows = engagementIds.length
    ? (
        await supabase
          .from("engagements")
          .select("id, title, client_id")
          .in("id", engagementIds)
      ).data ?? []
    : [];
  // Client ids to resolve: from each row's engagement, PLUS from metadata for
  // firm-wide rows not tied to an engagement (e.g. client_reassigned carries
  // metadata.client_id). Union both so those rows still show the client name +
  // link even though they have no engagement_id.
  const metadataClientIds = entries
    .filter((e) => e.engagement_id == null)
    .map((e) =>
      typeof e.metadata?.client_id === "string" ? e.metadata.client_id : null,
    )
    .filter((id): id is string => id != null);
  const clientIds = Array.from(
    new Set([
      ...engagementRows
        .map((r) => r.client_id as string | null)
        .filter((id): id is string => id != null),
      ...metadataClientIds,
    ]),
  );
  const clientRows = clientIds.length
    ? (
        await supabase
          .from("clients")
          .select("id, display_name")
          .in("id", clientIds)
      ).data ?? []
    : [];
  const userIds = Array.from(
    new Set(
      entries
        .filter((e) => e.actor_type === "user")
        .map((e) => e.actor_id)
        .filter((id): id is string => id != null),
    ),
  );
  const userRows = userIds.length
    ? (
        await supabase
          .from("users")
          .select("id, name, display_name, email")
          .in("id", userIds)
      ).data ?? []
    : [];

  const engById = new Map(
    engagementRows.map((e) => [
      e.id as string,
      e as { id: string; title: string; client_id: string },
    ]),
  );
  const clientById = new Map(
    clientRows.map((c) => [
      c.id as string,
      c as { id: string; display_name: string },
    ]),
  );
  const userById = new Map(
    userRows.map((u) => [
      u.id as string,
      u as {
        id: string;
        name: string | null;
        display_name: string | null;
        email: string;
      },
    ]),
  );

  return enrichActivityEntries(entries, engById, clientById, userById);
}

// Pure join: resolve each activity row's engagement title, client, and actor
// name from pre-fetched lookup maps. Engagement-scoped rows resolve their client
// via the engagement; firm-wide rows with no engagement (e.g. client_reassigned)
// resolve the client directly from metadata.client_id. Extracted from
// listActivityForFirm so the join logic is unit-testable without a database.
export function enrichActivityEntries(
  entries: ActivityEntry[],
  engById: Map<
    string,
    { id: string; title: string; client_id: string }
  >,
  clientById: Map<string, { id: string; display_name: string }>,
  userById: Map<
    string,
    {
      id: string;
      name: string | null;
      display_name: string | null;
      email: string;
    }
  >,
): FirmActivityEntry[] {
  return entries.map((e) => {
    const eng = e.engagement_id ? engById.get(e.engagement_id) : undefined;
    const metaClientId =
      typeof e.metadata?.client_id === "string" ? e.metadata.client_id : null;
    const clientId = eng?.client_id ?? metaClientId;
    const client = clientId ? clientById.get(clientId) : undefined;
    const actor =
      e.actor_type === "user" && e.actor_id
        ? userById.get(e.actor_id)
        : undefined;
    const actorName =
      actor?.display_name?.trim() ||
      actor?.name?.trim() ||
      actor?.email ||
      null;
    return {
      ...e,
      engagement_title: eng?.title ?? null,
      client_id: client?.id ?? clientId ?? null,
      client_display_name: client?.display_name ?? null,
      actor_name: actorName,
    };
  });
}

export async function logUserActivity(
  firmId: string,
  // null for firm-wide events that aren't scoped to a single engagement
  // (e.g. firm data export). The schema column is nullable.
  engagementId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  await supabase.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "user",
    actor_id: auth.user?.id ?? null,
    action,
    metadata,
  });
}

export async function logSystemActivity(
  firmId: string,
  engagementId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  const supabase = await getServerSupabase();
  await supabase.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "system",
    action,
    metadata,
  });
}

// System activity written from a context with NO user session (the Stripe
// webhook). Uses the service role so the insert isn't blocked by RLS.
export async function logServiceRoleActivity(
  firmId: string,
  engagementId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  const sb = getServiceRoleSupabase();
  const { error } = await sb.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "system",
    action,
    metadata,
  });
  if (error) {
    console.error("[activity] logServiceRoleActivity failed:", error);
  }
}
