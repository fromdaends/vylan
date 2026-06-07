import { getServiceRoleSupabase } from "@/lib/supabase/server";

// Per-firm monthly AI-check cap. The AI document check auto-pauses for the rest
// of the calendar month (UTC) once a firm reaches its cap, to bound token spend
// (migration 0230). Uploads + everything else keep working; only the AI skips.
export const DEFAULT_AI_MONTHLY_CAP = 400;

export type AiUsage = {
  used: number;
  cap: number;
  paused: boolean;
  /** ISO timestamp — first day of next UTC month, when the meter resets. */
  resetsAt: string;
};

// PURE: given used + cap (+ the current time), is the firm paused, and when
// does the meter reset? Exported for testing.
export function aiCapStatus(used: number, cap: number, now: Date): AiUsage {
  const safeCap =
    Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_AI_MONTHLY_CAP;
  const reset = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    used,
    cap: safeCap,
    paused: used >= safeCap,
    resetsAt: reset.toISOString(),
  };
}

// Current UTC month as a 'YYYY-MM-01' key (matches date_trunc('month', utc)).
function utcMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// Read a firm's current-month AI usage + cap. Resilient: if migration 0230
// isn't applied yet (missing column/table) the queries return errors (not
// throws) and we fall back to 0 used / default cap / NOT paused — so the AI
// keeps working and this is safe to deploy before the migration lands.
export async function getFirmAiUsage(firmId: string): Promise<AiUsage> {
  const now = new Date();
  let cap = DEFAULT_AI_MONTHLY_CAP;
  let used = 0;
  try {
    const sb = await getServiceRoleSupabase();
    const { data: firm } = await sb
      .from("firms")
      .select("ai_monthly_cap")
      .eq("id", firmId)
      .single();
    if (firm && typeof firm.ai_monthly_cap === "number") {
      cap = firm.ai_monthly_cap;
    }
    const { data: row } = await sb
      .from("ai_usage_monthly")
      .select("used")
      .eq("firm_id", firmId)
      .eq("period_month", utcMonthKey(now))
      .maybeSingle();
    if (row && typeof row.used === "number") used = row.used;
  } catch {
    // pre-migration / transient — fall through to defaults (not paused).
  }
  return aiCapStatus(used, cap, now);
}

// Count one AI check against the firm's monthly meter (atomic upsert via the
// increment_ai_usage RPC). Best-effort: no-op if 0230 isn't applied yet.
export async function incrementFirmAiUsage(firmId: string): Promise<void> {
  try {
    const sb = await getServiceRoleSupabase();
    await sb.rpc("increment_ai_usage", { p_firm_id: firmId });
  } catch {
    // metering is best-effort; never block the pipeline on it.
  }
}
