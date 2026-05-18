import { getServerSupabase } from "@/lib/supabase/server";
import type { ActivityEntry } from "@/lib/db/activity";

export const AI_ACTIONS = [
  "ai_classified",
  "ai_auto_rejected",
  "ai_escalated_to_accountant",
  "ai_quality_flagged",
  "ai_rejection_overridden",
] as const;

export type AiActivityEntry = ActivityEntry & {
  engagement_title: string | null;
  client_id: string | null;
  client_display_name: string | null;
};

// Lists AI-related activity_log rows for the current firm (RLS scopes
// it). Each row is enriched with the parent engagement's title +
// client display_name so the UI can show "what happened, on which
// engagement, for which client" without a per-row roundtrip.
export async function listAiActivityForFirm(limit = 200): Promise<
  AiActivityEntry[]
> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .in("action", AI_ACTIONS as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(limit);
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
  if (engagementIds.length === 0) {
    return entries.map((e) => ({
      ...e,
      engagement_title: null,
      client_id: null,
      client_display_name: null,
    }));
  }

  const { data: engagementRows, error: engErr } = await supabase
    .from("engagements")
    .select("id, title, client_id")
    .in("id", engagementIds);
  if (engErr) throw engErr;

  const clientIds = Array.from(
    new Set(
      (engagementRows ?? [])
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
  const clientById = new Map(clientRows.map((c) => [c.id as string, c]));
  const engById = new Map(
    (engagementRows ?? []).map((e) => [
      e.id as string,
      e as { id: string; title: string; client_id: string },
    ]),
  );

  return entries.map((e) => {
    const eng = e.engagement_id ? engById.get(e.engagement_id) : undefined;
    const client = eng?.client_id ? clientById.get(eng.client_id) : undefined;
    return {
      ...e,
      engagement_title: eng?.title ?? null,
      client_id: client?.id ?? null,
      client_display_name: (client?.display_name as string | undefined) ?? null,
    };
  });
}
