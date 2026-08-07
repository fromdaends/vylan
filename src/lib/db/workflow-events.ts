// Reader for the workflow ledger (workflow_stage_events) — the engagement
// page's timeline is the only consumer today. READ-ONLY on purpose: the table
// has no insert/update policies for users; only the effects runner (service
// role) writes, and every surface that wants "what fired" reads through here
// rather than querying the table from a page.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkflowEventRow } from "@/lib/workflow/timeline";

export async function listWorkflowEvents(
  sb: SupabaseClient,
  engagementId: string,
): Promise<WorkflowEventRow[]> {
  const { data, error } = await sb
    .from("workflow_stage_events")
    .select("stage, action, status, detail, created_at")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true });
  if (error) {
    // Pre-1560 (42P01: table absent) reads as an empty ledger — the truth
    // for that environment. Anything else is a real failure and must say so
    // in the log: this card exists to expose silent misses, so it cannot
    // silently miss its own read. Either way the page keeps rendering.
    if (error.code !== "42P01") {
      console.error("[workflow] ledger read failed:", error);
    }
    return [];
  }
  return (data ?? []) as WorkflowEventRow[];
}
