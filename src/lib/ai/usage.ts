import { getServiceRoleSupabase } from "@/lib/supabase/server";

// Per-firm monthly AI-check cap. The AI document check auto-pauses for the rest
// of the calendar month (UTC) once a firm reaches its cap, to bound token spend
// (migration 0230). Uploads + everything else keep working; only the AI skips.
// Default lowered 400 -> 350 (migration 0310) to tighten the monthly spend
// ceiling. The per-firm firms.ai_monthly_cap column (read in getFirmAiUsage)
// still overrides this; this constant is the fallback + the new-firm default.
export const DEFAULT_AI_MONTHLY_CAP = 350;

// Free-trial firms get a hard LIFETIME ceiling on paid AI checks (NOT a monthly
// one) so an unconverted account can't burn unbounded AI — a known cost/abuse
// hole where a trial had the same AI powers as a paying firm. Deliberately low:
// a trial is for evaluating, not running a practice. The cap lifts the moment
// the firm converts to a paid plan (is_demo flips false). Tunable here.
export const TRIAL_AI_TOTAL_CAP = 10;

export type AiUsage = {
  used: number;
  cap: number;
  paused: boolean;
  /** ISO timestamp — first day of next UTC month, when a MONTHLY meter resets.
   *  For the trial cap this carries the trial end (informational only — the cap
   *  lifts on UPGRADE, not at a date), or "" when unknown. */
  resetsAt: string;
  /** true = the trial LIFETIME cap (lifts on upgrade); false = the normal
   *  per-calendar-month cap (resets at resetsAt). Drives "upgrade" vs
   *  "resets next month" messaging. */
  isTrial: boolean;
};

// Trial firms that haven't started paying get the lifetime AI cap. A firm that
// has begun a paid/trialing subscription is exempt even if is_demo hasn't been
// flipped to false yet (Stripe webhook lag), so a converting customer is never
// throttled. Mirrors the subscription exemption in isTrialExpired. PURE.
export function isTrialCapped(firm: {
  is_demo?: boolean | null;
  subscription_status?: string | null;
}): boolean {
  if (firm.is_demo !== true) return false;
  const sub = firm.subscription_status;
  return sub !== "active" && sub !== "trialing";
}

// PURE: given used + cap (+ the current time), is the firm paused, and when
// does the MONTHLY meter reset? Exported for testing.
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
    isTrial: false,
  };
}

// PURE: trial LIFETIME cap status. `used` is the firm's all-time AI-check total
// (summed across every month), not the current month. Exported for testing.
export function aiTrialCapStatus(
  used: number,
  cap: number,
  trialEndsAt: string | null,
): AiUsage {
  const safeCap = Number.isFinite(cap) && cap >= 0 ? cap : TRIAL_AI_TOTAL_CAP;
  return {
    used,
    cap: safeCap,
    paused: used >= safeCap,
    resetsAt: trialEndsAt ?? "",
    isTrial: true,
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
      .select("ai_monthly_cap, is_demo, subscription_status, trial_ends_at")
      .eq("id", firmId)
      .single();

    // Free-trial firms: a hard LIFETIME ceiling (the firm's all-time AI-check
    // total, summed across every month) instead of the monthly cap, so an
    // unconverted account can't burn unbounded paid AI. Lifts on conversion.
    if (firm && isTrialCapped(firm)) {
      const { data: rows } = await sb
        .from("ai_usage_monthly")
        .select("used")
        .eq("firm_id", firmId);
      const total = (rows ?? []).reduce(
        (n, r) => n + (typeof r.used === "number" ? r.used : 0),
        0,
      );
      return aiTrialCapStatus(
        total,
        TRIAL_AI_TOTAL_CAP,
        (firm.trial_ends_at as string | null) ?? null,
      );
    }

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
