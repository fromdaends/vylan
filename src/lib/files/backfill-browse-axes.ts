// Filling in browse axes for documents that predate migration 1070.
//
// Every document uploaded before 1070 has browse_axes_at = null and therefore
// no year and no category — which in the Files browser means every historical
// document piles into "Unsorted" until something computes them. There are
// potentially tens of thousands per firm.
//
// WHY THIS IS A CRON SWEEP AND NOT A SCRIPT
//
// The obvious answer is a one-off backfill script. It was rejected: it makes a
// non-developer pull production service-role credentials onto a laptop and run
// a command at exactly the right moment, and if it half-finishes nobody knows.
// Worse, it has a race with its own migration — documents classified in the gap
// between the SQL being applied and the script being run would be missed
// permanently, and the symptom (a handful of files stuck in Unsorted forever)
// is invisible until a firm complains.
//
// So instead this runs from the jobs cron that is already scheduled, already
// authenticated, and already running every couple of minutes. It is:
//
//   * SELF-TERMINATING — it claims rows WHERE browse_axes_at IS NULL, and every
//     row it touches gets stamped. Once the backlog is drained the claim query
//     hits an empty partial index and costs nothing.
//   * SELF-HEALING — a row that fails today (a transient read error) is simply
//     picked up on a later sweep, because it was never stamped.
//   * BOUNDED — a fixed batch per run, so it can never starve the real jobs
//     sharing that cron invocation's time budget.
//   * SILENT WHEN DORMANT — pre-1070 the claim query errors on a missing
//     column, which is reported as "unavailable" and swallowed by the caller.

import type { SupabaseClient } from "@supabase/supabase-js";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import { applyDerivedAxes, deriveBrowseAxes } from "./axes";

// Documents per cron invocation. Deliberately modest: this shares its run with
// the real job queue, and a firm's backlog draining over an hour of sweeps is
// completely fine — nobody is watching, and the alternative is a cron timeout
// that also kills the reminders and notification emails queued behind it.
const BATCH_SIZE = 200;

export type BackfillResult = {
  /** Rows examined this run. 0 means the backlog is drained (or dormant). */
  scanned: number;
  /** Rows whose year or category actually changed. */
  updated: number;
  /** Set when the schema isn't there yet — the caller should stay quiet. */
  unavailable?: boolean;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

type UploadRow = {
  id: string;
  engagement_id: string;
  ai_classification: string | null;
  ai_confidence: number | null;
  ai_extracted_fields: Record<string, unknown> | null;
  browse_year: number | null;
  browse_category: string | null;
  browse_year_manual: boolean | null;
  browse_category_manual: boolean | null;
};

/**
 * Compute browse axes for one batch of never-computed uploads.
 *
 * Service-role: this is a cron with no session, and the sweep spans every firm
 * by design. Nothing here is firm-scoped because nothing here is firm-specific
 * — it recomputes a document's own position from the document's own fields.
 */
export async function backfillBrowseAxesBatch(
  sb: SupabaseClient,
  batchSize = BATCH_SIZE,
): Promise<BackfillResult> {
  const { data: rows, error } = await sb
    .from("uploaded_files")
    .select(
      "id, engagement_id, ai_classification, ai_confidence, ai_extracted_fields, browse_year, browse_category, browse_year_manual, browse_category_manual",
    )
    .is("browse_axes_at", null)
    .order("uploaded_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    // 1070 not applied: Files is dormant and so is this.
    return { scanned: 0, updated: 0, unavailable: true };
  }
  const batch = (rows ?? []) as UploadRow[];
  if (batch.length === 0) return { scanned: 0, updated: 0 };

  // One read for every engagement in the batch rather than one per document.
  // A batch is usually a handful of engagements (uploads arrive in bursts), so
  // this collapses ~200 queries into 1.
  const engagementIds = [...new Set(batch.map((r) => r.engagement_id))];
  const { data: engRows } = await sb
    .from("engagements")
    .select("id, title, due_date, tax_year")
    .in("id", engagementIds);
  const engagements = new Map(
    ((engRows ?? []) as Array<Record<string, unknown>>).map((e) => [
      e.id as string,
      e,
    ]),
  );

  const stampedAt = new Date().toISOString();
  let updated = 0;

  for (const row of batch) {
    const eng = engagements.get(row.engagement_id);
    const fields = row.ai_extracted_fields ?? {};
    const derived = deriveBrowseAxes({
      extractedYear: num(fields.extracted_year),
      engagementTaxYear: num(eng?.tax_year),
      titleYear: expectedYearFromTitle(str(eng?.title) ?? ""),
      dueDate: str(eng?.due_date),
      aiDocType: row.ai_classification,
      aiConfidence: row.ai_confidence,
    });
    const patch = applyDerivedAxes(
      {
        browseYear: num(row.browse_year),
        browseCategory: str(row.browse_category),
        browseYearManual: row.browse_year_manual === true,
        browseCategoryManual: row.browse_category_manual === true,
      },
      derived,
    );

    // Stamped whether or not anything changed — the stamp is what removes this
    // row from the sweep. A row left unstamped because "nothing to do" would be
    // re-read on every single sweep for the life of the product.
    const { error: updErr } = await sb
      .from("uploaded_files")
      .update({ ...patch, browse_axes_at: stampedAt })
      .eq("id", row.id);
    // Deliberately not aborting the batch: one bad row (a document whose
    // engagement was hard-purged mid-sweep) must not block the other 199. It
    // stays unstamped and gets another chance next run.
    if (updErr) {
      console.warn("[files/backfill] row failed:", row.id, updErr.message);
      continue;
    }
    if (Object.keys(patch).length > 0) updated++;
  }

  return { scanned: batch.length, updated };
}
