// Deciding what a Move actually changes.
//
// Pulled out of the server action as a PURE function, because this is where all
// the real risk in Move lives: which columns get written, whether the manual
// flags are set, and whether a document type silently drags the category with
// it. None of that is observable from a screenshot, and all of it is trivially
// testable here.

import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import { categoryForDocType, isBrowseCategory } from "@/lib/files/axes";
import type { DocumentSource } from "@/lib/db/documents";

// Which tables carry the browse_*_manual flags. Only sources that can be
// RE-CLASSIFIED need them: an imported document never goes near the AI, so
// there is nothing to protect its axes from and migration 1070 gave it no such
// columns. Writing the flag anyway makes every move of an imported file fail
// with a missing-column error — and imports are precisely the files that need
// moving most, since they arrive unsorted by design.
export const HAS_MANUAL_FLAGS: Record<DocumentSource, boolean> = {
  checklist: true,
  final: true,
  imported: false,
};

export type MoveFields = {
  /** Absent/empty = leave alone. "none" = clear it. */
  docType?: string | null;
  /** Absent/empty = leave alone. "unsorted" = the Unsorted folder. */
  year?: string | null;
  /** Absent/empty = leave alone. "unsorted" = the Unsorted folder. */
  category?: string | null;
};

export type MovePatch = Record<string, unknown>;

/**
 * Build the database patch for a Move, or say why the input was invalid.
 *
 * Rules, in order of precedence:
 *  - A document TYPE implies a category (a T4 is a federal slip), so setting
 *    the type fills the category in. That is what makes hand-sorting a pile of
 *    imported files bearable.
 *  - An EXPLICIT category always wins over the implied one, so a firm that
 *    files differently is never overruled.
 *  - Any axis this touches is marked manual, which is what stops a later
 *    re-classification quietly undoing the person's decision.
 */
export function buildMovePatch(
  source: DocumentSource,
  fields: MoveFields,
): { ok: true; patch: MovePatch } | { ok: false; reason: string } {
  const patch: MovePatch = {};
  const flags = HAS_MANUAL_FLAGS[source];

  let impliedCategory: string | null | undefined;
  if (fields.docType) {
    if (fields.docType === "none") {
      patch.manual_doc_type = null;
    } else if (fields.docType in DOC_TYPE_LABELS) {
      patch.manual_doc_type = fields.docType;
      impliedCategory = categoryForDocType(
        fields.docType as keyof typeof DOC_TYPE_LABELS,
      );
    } else {
      return { ok: false, reason: "unknown_doc_type" };
    }
  }

  if (fields.year) {
    if (fields.year === "unsorted") {
      patch.browse_year = null;
    } else {
      const y = Number(fields.year);
      if (!Number.isInteger(y) || y < 1990 || y > 2100) {
        return { ok: false, reason: "bad_year" };
      }
      patch.browse_year = y;
    }
    if (flags) patch.browse_year_manual = true;
  }

  if (fields.category) {
    if (fields.category === "unsorted") {
      patch.browse_category = null;
    } else if (isBrowseCategory(fields.category)) {
      patch.browse_category = fields.category;
    } else {
      return { ok: false, reason: "unknown_category" };
    }
    if (flags) patch.browse_category_manual = true;
  } else if (impliedCategory !== undefined) {
    patch.browse_category = impliedCategory;
    if (flags) patch.browse_category_manual = true;
  }

  if (Object.keys(patch).length === 0) return { ok: false, reason: "nothing_to_do" };
  return { ok: true, patch };
}
