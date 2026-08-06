import { getServerSupabase } from "@/lib/supabase/server";

// The capacity board's own numbers: planned hours, worked hours, manual order.
//
// ── WHY ACTUAL IS NOT A COLUMN ─────────────────────────────────────────────
//
// The design handoff asks for `actual_minutes` on the engagement. Time tracking
// shipped before this board did (#1455 / #1459 / #1464), so `time_entries` is
// already the record of hours worked — and a stored copy would be wrong the
// first time somebody edited or deleted an entry. Actual is SUMMED here, at
// read time, from the rows that are the truth.
//
// The handoff anticipated this itself: "actual_minutes (or derive actual from
// time entries later)". Later is now.
//
// ── ONE QUERY, NOT ONE PER CARD ────────────────────────────────────────────
//
// A board is thirty to two hundred cards. Reading each card's hours on its own
// would be the N+1 this repo has already paid for elsewhere, so both halves are
// batched by engagement id and returned as maps the caller indexes into.

export type BoardNumbers = {
  /** Planned minutes, or null when nobody has budgeted this job. NULL IS NOT
   *  ZERO: an unbudgeted job renders "—", because "0h planned" is a claim
   *  nobody made. */
  budgetMinutes: number | null;
  /** Minutes actually worked, summed from time_entries. Zero is honest here —
   *  nobody has started. */
  actualMinutes: number;
  /** Manual position within its column. Null = never dragged; sorts last and
   *  leaves the list's own ordering alone. */
  boardRank: number | null;
};

/**
 * Budget, actual and rank for a set of engagements, keyed by engagement id.
 *
 * Missing ids simply do not appear — the caller falls back to
 * `EMPTY_BOARD_NUMBERS`, which is also what happens before migration 1790 is
 * applied: the two columns come back undefined, every card reads "—" for
 * budget, and the board is otherwise exactly as useful. The feature degrades to
 * "no hours yet", never to a crash.
 */
export async function loadBoardNumbers(
  engagementIds: string[],
): Promise<Map<string, BoardNumbers>> {
  const out = new Map<string, BoardNumbers>();
  if (engagementIds.length === 0) return out;

  const sb = await getServerSupabase();

  const [{ data: engagements }, { data: entries }] = await Promise.all([
    // `select("*")` deliberately: naming budget_minutes / board_rank would make
    // this query FAIL on a database where 1790 has not run yet, taking the whole
    // board down rather than degrading. A star select simply does not carry the
    // keys until they exist.
    sb.from("engagements").select("*").in("id", engagementIds),
    sb
      .from("time_entries")
      .select("engagement_id, duration_minutes")
      .in("engagement_id", engagementIds),
  ]);

  const worked = new Map<string, number>();
  for (const e of (entries ?? []) as {
    engagement_id: string | null;
    duration_minutes: number | null;
  }[]) {
    if (!e.engagement_id) continue;
    worked.set(
      e.engagement_id,
      (worked.get(e.engagement_id) ?? 0) + (e.duration_minutes ?? 0),
    );
  }

  for (const row of (engagements ?? []) as Record<string, unknown>[]) {
    const id = String(row.id);
    out.set(id, {
      budgetMinutes: numberOrNull(row.budget_minutes),
      actualMinutes: worked.get(id) ?? 0,
      boardRank: numberOrNull(row.board_rank),
    });
  }
  return out;
}

export const EMPTY_BOARD_NUMBERS: BoardNumbers = {
  budgetMinutes: null,
  actualMinutes: 0,
  boardRank: null,
};

/** Guards against the column being absent (pre-1790) AND against a string
 *  arriving from a numeric type, which PostgREST does for some of them. */
function numberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
