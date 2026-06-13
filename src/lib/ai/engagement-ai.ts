import type { SupabaseClient } from "@supabase/supabase-js";

// Per-engagement "AI Analyze" toggle (migration 0340, engagements.ai_enabled).
//
// AI is OFF for an engagement ONLY when ai_enabled is explicitly false. A
// missing column (the migration not applied to this environment yet), null, or
// true all read as ON — so the AI keeps working everywhere until a firm
// deliberately turns it off, and the engine gates below are safe to ship before
// the migration lands. This is the single source of truth for "is AI on for
// this engagement", shared by the per-file classifier and the set assessment.

// PURE: decide on/off from an engagement row. Exported for tests.
export function aiEnabledFromRow(
  row: { ai_enabled?: boolean | null } | null | undefined,
): boolean {
  return row?.ai_enabled !== false;
}

// Best-effort read for the AI workers. Defaults to ON (true) on ANY error — a
// missing column (pre-migration) or a transient read must never silently
// disable a firm's AI; only an explicit ai_enabled=false turns it off.
export async function isEngagementAiEnabled(
  sb: SupabaseClient,
  engagementId: string,
): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from("engagements")
      .select("ai_enabled")
      .eq("id", engagementId)
      .maybeSingle();
    if (error) return true; // column missing / transient → default ON
    return aiEnabledFromRow(data as { ai_enabled?: boolean | null } | null);
  } catch {
    return true;
  }
}
