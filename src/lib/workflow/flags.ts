// The two feature switches (migration 1560, firms.workflows_enabled /
// firms.ai_suggestions_enabled).
//
// POLARITY: these default OFF — the opposite of ai_enabled's default-on —
// because they gate a NEW behaviour. A missing column (migration not applied),
// a read error, or an absent row must all read as "off": the engine then
// leaves every engagement on the legacy path, which is exactly today's
// behaviour. Only an explicit true turns anything on.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function isWorkflowsEnabledForFirm(
  sb: SupabaseClient,
  firmId: string,
): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from("firms")
      .select("workflows_enabled")
      .eq("id", firmId)
      .maybeSingle();
    if (error || !data) return false;
    return (data as { workflows_enabled?: boolean }).workflows_enabled === true;
  } catch {
    return false;
  }
}

export async function isAiSuggestionsEnabledForFirm(
  sb: SupabaseClient,
  firmId: string,
): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from("firms")
      .select("ai_suggestions_enabled")
      .eq("id", firmId)
      .maybeSingle();
    if (error || !data) return false;
    return (
      (data as { ai_suggestions_enabled?: boolean }).ai_suggestions_enabled ===
      true
    );
  } catch {
    return false;
  }
}
