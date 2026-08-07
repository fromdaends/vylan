// THE WATCHLIST — reading and writing founder_pinned_firms (migration 1800).
//
// ⚠️ THIS IS THE ONE PART OF THE FOUNDERS CONSOLE THAT WRITES. Everything else
// in lib/founders reads. Both functions here are still gated the same way: the
// server action that calls them re-checks getFounderUser() first, and this
// table is unreachable by `authenticated` at all (RLS on, zero policies).
//
// ── FAIL-SOFT WHILE 1800 IS UNAPPLIED ──────────────────────────────────────
//
// The code ships before the migration is run — that is the normal order in this
// repo, not an accident. So:
//
//   listPinnedFirmIds()  →  { ids: [], available: false }
//   setPinned()          →  { ok: false, reason: "unavailable" }
//
// and the UI hides the pin control rather than showing one that silently does
// nothing. A button that looks like it worked and did not is worse than no
// button — the founder has said as much about dead controls more than once.

import { getServiceRoleSupabase } from "@/lib/supabase/server";

export type PinState = {
  ids: string[];
  /** False when migration 1800 has not been applied (or the read failed). */
  available: boolean;
};

/** Postgres/PostgREST codes that mean "this table is not there yet", as opposed
 *  to "the query was wrong". PGRST205 is PostgREST's schema-cache miss; 42P01 is
 *  Postgres' own undefined_table. Anything else is a real error and is logged. */
function isMissingTable(code: string | undefined, message: string): boolean {
  if (code === "PGRST205" || code === "42P01") return true;
  return /founder_pinned_firms/.test(message) && /does not exist|schema cache/i.test(message);
}

export async function listPinnedFirmIds(): Promise<PinState> {
  try {
    const sb = getServiceRoleSupabase();
    const { data, error } = await sb
      .from("founder_pinned_firms")
      .select("firm_id")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      if (!isMissingTable(error.code, error.message)) {
        console.error("[founders/pins] list failed:", error.message);
      }
      return { ids: [], available: false };
    }
    return { ids: (data ?? []).map((r) => r.firm_id as string), available: true };
  } catch (e) {
    console.error("[founders/pins] list threw:", e instanceof Error ? e.message : e);
    return { ids: [], available: false };
  }
}

export type PinResult = { ok: true; pinned: boolean } | { ok: false; reason: "unavailable" | "failed" };

/**
 * Pin or unpin a firm. Idempotent in both directions: pinning an already-pinned
 * firm succeeds (upsert on the PK), unpinning one that is not pinned succeeds.
 * That matters because the button is a TOGGLE — a double-click, a stale page or
 * two founders clicking at once must not produce an error dialog for what is
 * already the desired state.
 */
export async function setPinned(
  firmId: string,
  pinned: boolean,
  byUserId: string | null,
): Promise<PinResult> {
  try {
    const sb = getServiceRoleSupabase();

    if (!pinned) {
      const { error } = await sb.from("founder_pinned_firms").delete().eq("firm_id", firmId);
      if (error) {
        if (isMissingTable(error.code, error.message)) return { ok: false, reason: "unavailable" };
        console.error("[founders/pins] unpin failed:", error.message);
        return { ok: false, reason: "failed" };
      }
      return { ok: true, pinned: false };
    }

    const { error } = await sb
      .from("founder_pinned_firms")
      .upsert({ firm_id: firmId, pinned_by_user_id: byUserId }, { onConflict: "firm_id" });
    if (error) {
      if (isMissingTable(error.code, error.message)) return { ok: false, reason: "unavailable" };
      console.error("[founders/pins] pin failed:", error.message);
      return { ok: false, reason: "failed" };
    }
    return { ok: true, pinned: true };
  } catch (e) {
    console.error("[founders/pins] write threw:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "failed" };
  }
}
