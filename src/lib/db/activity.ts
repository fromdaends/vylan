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

export async function logUserActivity(
  firmId: string,
  engagementId: string,
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
