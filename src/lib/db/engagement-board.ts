import { getServerSupabase } from "@/lib/supabase/server";
import { resolveBudgetMinutes } from "@/lib/engagements/board-stats";
// Shared across the server/client boundary, so they live in a module that
// imports neither side — see the note at the top of board-numbers.ts.
import type { BoardNumbers } from "@/lib/engagements/board-numbers";

export type { BoardNumbers };
export { EMPTY_BOARD_NUMBERS } from "@/lib/engagements/board-numbers";

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

  const [{ data: engagements }, { data: entries }, { data: items }] =
    await Promise.all([
    // `select("*")` deliberately: naming budget_minutes / board_rank would make
    // this query FAIL on a database where 1790 has not run yet, taking the whole
    // board down rather than degrading. A star select simply does not carry the
    // keys until they exist.
    sb.from("engagements").select("*").in("id", engagementIds),
    sb
      .from("time_entries")
      .select("engagement_id, duration_minutes")
      .in("engagement_id", engagementIds),
    // The priced lines, so a budget can be ASSEMBLED from the services the job
    // actually sells — the founder's ruling over a number typed per job. The
    // nested select reaches the catalogue's duration in one round trip rather
    // than one per engagement.
    // `*` for the row's own columns, for the same reason as the engagements
    // query above: naming budget_minutes here would make this FAIL on a
    // database where 1820 has not run, and `items` would arrive undefined —
    // every engagement's budget would read as null and the board's whole
    // Budget column would blank out. The embed is still named, because an
    // embed is a join and cannot be starred alongside the parent's own star.
    sb
      .from("engagement_items")
      .select("*, firm_services(budget_minutes)")
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

  // Per engagement, the duration of each service line — nulls KEPT, because
  // "three services, none timed" and "no services" are different answers and
  // only one of them may total to a number. See resolveBudgetMinutes.
  const serviceMinutes = new Map<string, (number | null)[]>();
  for (const raw of (items ?? []) as unknown[]) {
    const it = raw as {
      engagement_id?: string | null;
      /** The line's OWN duration (1820). Absent pre-migration. */
      budget_minutes?: number | null;
      // PostgREST returns an OBJECT for a many-to-one embed, but the generated
      // types say array. Both are handled rather than cast away, because the
      // wrong guess here silently gives every engagement a null budget.
      firm_services?:
        | { budget_minutes?: number | null }
        | { budget_minutes?: number | null }[]
        | null;
    };
    if (!it.engagement_id) continue;
    const svc = Array.isArray(it.firm_services)
      ? it.firm_services[0]
      : it.firm_services;
    const list = serviceMinutes.get(it.engagement_id) ?? [];
    // ── THE LINE'S OWN HOURS WIN (1820) ──────────────────────────────────
    //
    // This used to read ONLY through the embed, so a line's budget was
    // whatever catalogue entry it pointed at. Two consequences, both bad:
    // a hand-typed line ("Not from your catalogue") pointed at nothing and
    // contributed null while its tracked time still counted against the job,
    // and editing a service in the catalogue retroactively re-planned every
    // engagement that had ever used it.
    //
    // The line carries its own duration now, seeded from the service when one
    // is picked. Falling back to the embed keeps every row written before 1820
    // reading exactly as it did, so nothing re-plans on deploy.
    list.push(numberOrNull(it.budget_minutes) ?? numberOrNull(svc?.budget_minutes));
    serviceMinutes.set(it.engagement_id, list);
  }

  for (const row of (engagements ?? []) as Record<string, unknown>[]) {
    const id = String(row.id);
    out.set(id, {
      budgetMinutes: resolveBudgetMinutes({
        // A number here means somebody disagreed with the sum for this job.
        overrideMinutes: numberOrNull(row.budget_minutes),
        serviceMinutes: serviceMinutes.get(id) ?? [],
      }),
      actualMinutes: worked.get(id) ?? 0,
      boardRank: numberOrNull(row.board_rank),
    });
  }
  return out;
}


/** Guards against the column being absent (pre-1790) AND against a string
 *  arriving from a numeric type, which PostgREST does for some of them. */
function numberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
