import { getServerSupabase } from "@/lib/supabase/server";

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
  const clientIds = Array.from(
    new Set(
      engagementRows
        .map((r) => r.client_id as string | null)
        .filter((id): id is string => id != null),
    ),
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

  const enriched: FirmActivityEntry[] = entries.map((e) => {
    const eng = e.engagement_id ? engById.get(e.engagement_id) : undefined;
    const client = eng?.client_id ? clientById.get(eng.client_id) : undefined;
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
      client_id: client?.id ?? null,
      client_display_name: client?.display_name ?? null,
      actor_name: actorName,
    };
  });

  return enriched;
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
