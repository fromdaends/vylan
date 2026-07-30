// Keeping a document's BROWSE AXES in step with what the AI decided.
//
// migration 1070 stores browse_year / browse_category on every document so the
// Files browser can filter, group, sort and PAGE in SQL. Something has to write
// them, and that something is here: called once per classification, right after
// the classification itself has landed.
//
// THREE DELIBERATE PROPERTIES, all of them the same instinct — this is a
// convenience feature bolted onto the app's most expensive, most
// failure-prone path, and it must never be the reason that path breaks:
//
//   1. ITS OWN READ. It does not extend the engagement select on the rate-limit
//      path in process.ts. That select's failure mode is "fail CLOSED rather
//      than spend uncapped AI" — so adding a column to it would couple ALL
//      classification to this migration having been applied. One extra tiny
//      query is worth not having that rope in the building.
//
//   2. ITS OWN WRITE, best-effort. A missing column (1070 not applied yet)
//      logs a warning and returns; the classification above is untouched.
//      Same shape as the display_name write (0280) and flagNearDuplicate
//      (0990) that already sit beside it.
//
//   3. NEVER THROWS. Every path returns a reason string instead. The caller is
//      a cron worker mid-way through a document, and there is nothing it could
//      usefully do with an exception from a folder-position update.

import type { SupabaseClient } from "@supabase/supabase-js";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import { applyDerivedAxes, deriveBrowseAxes } from "./axes";

export type AxesSyncResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: string };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Recompute and store where this upload belongs in the Files browser.
 *
 * Reads the row's CURRENT axis state first, because the manual flags are the
 * whole point: an accountant who hand-sorted this file must keep their answer
 * (see applyDerivedAxes). Writes only the axes nobody has claimed, and only
 * when they actually differ.
 *
 * Service-role client — the caller is the classify worker, which has no
 * session. Scope is already proven: the file id came from the job payload and
 * every read here is keyed by it.
 */
export async function syncBrowseAxesForUpload(
  sb: SupabaseClient,
  input: {
    fileId: string;
    engagementId: string;
    aiDocType: string | null;
    aiConfidence: number | null;
    extractedYear: number | null;
  },
): Promise<AxesSyncResult> {
  try {
    const { data: row, error: rowErr } = await sb
      .from("uploaded_files")
      .select(
        "browse_year, browse_category, browse_year_manual, browse_category_manual",
      )
      .eq("id", input.fileId)
      .maybeSingle();
    if (rowErr) {
      // 1070 not applied here — Files is simply dormant, exactly as intended.
      return { ok: false, reason: `axes columns unavailable: ${rowErr.message}` };
    }
    if (!row) return { ok: false, reason: "file gone" };

    // The engagement half of the year chain. A failure here is NOT fatal: the
    // chain simply falls back to whatever the document itself said, which is
    // the highest-priority source anyway.
    const { data: eng } = await sb
      .from("engagements")
      .select("title, due_date, tax_year")
      .eq("id", input.engagementId)
      .maybeSingle();

    const derived = deriveBrowseAxes({
      extractedYear: input.extractedYear,
      // tax_year is a 0900 column; absent reads as null and the chain moves on.
      engagementTaxYear: num(eng?.tax_year),
      titleYear: expectedYearFromTitle(str(eng?.title) ?? ""),
      dueDate: str(eng?.due_date),
      aiDocType: input.aiDocType,
      aiConfidence: input.aiConfidence,
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

    // browse_axes_at is stamped even when nothing changed. It records "we have
    // computed this row", not "we changed this row" — which is what takes the
    // row out of the backfill sweep's sights permanently. Skipping the write on
    // a no-op would leave every already-correct document being re-examined on
    // every sweep, forever.
    const { error: updErr } = await sb
      .from("uploaded_files")
      .update({ ...patch, browse_axes_at: new Date().toISOString() })
      .eq("id", input.fileId);
    if (updErr) return { ok: false, reason: updErr.message };
    return { ok: true, changed: Object.keys(patch).length > 0 };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
