// BROWSE AXES — the year and category a document sits under in Files.
//
// The Files browser drills down Clients/{client}/{year}/{category}, which is
// the firm's default filing folder template. Those two values are NOT a second
// invention: they are the same {year} and {category} the filing engine renders
// into folder names, and this module is deliberately built on top of the filing
// tokens rather than beside them. If a document files into
// "Clients/Tremblay/2024/Federal slips", Browse must show it under 2024 ›
// Federal slips, and the only way to guarantee that forever is for both to ask
// the same functions.
//
// What is NEW here is persistence. The filing engine computes these at push
// time and throws them away; Browse needs them stored (migration 1070's
// browse_year / browse_category), because a value computed in TypeScript cannot
// be filtered, grouped, sorted or PAGED in SQL — and "Move this file to 2023"
// needs somewhere to write.
//
// Pure and client-safe: the Move dialog imports this to live-preview what
// picking a document type will do to the category.

import type { DocType } from "@/lib/db/templates";
import { DOC_TYPE_LABELS, type DocTypeGroup } from "@/lib/doc-types";
import { resolveYear, trustedDocTypeCode } from "@/lib/filing/tokens";

/**
 * A document's category is a doc-type GROUP — the same six buckets the grouped
 * doc-type pickers already use. Null is the "Unsorted" bucket (rendered with
 * UNSORTED_LABEL, never stored as the literal string "Unsorted": the label is
 * localized per firm and storing it would freeze one language into the data).
 */
export type BrowseCategory = DocTypeGroup;

export const BROWSE_CATEGORIES: readonly BrowseCategory[] = [
  "federal",
  "quebec",
  "credits",
  "forms",
  "bookkeeping",
  "other",
] as const;

export function isBrowseCategory(v: unknown): v is BrowseCategory {
  return (
    typeof v === "string" &&
    (BROWSE_CATEGORIES as readonly string[]).includes(v)
  );
}

export type BrowseAxes = {
  year: number | null;
  category: BrowseCategory | null;
};

/** The group a document type belongs to. Null in, null out. */
export function categoryForDocType(
  code: DocType | null | undefined,
): BrowseCategory | null {
  return code ? DOC_TYPE_LABELS[code].group : null;
}

/**
 * Which document type actually applies to a row, and whether a human chose it.
 *
 * A manual type always wins, unconditionally — that is the point of Move. It is
 * not confidence-checked (a person is not a classifier) but it IS validated
 * against the known codes, so a stale code left behind by a renamed doc type
 * degrades to "unknown" rather than crashing a page.
 *
 * The AI's answer only counts when it clears the shared trust threshold, the
 * same one that decides whether the type may appear in a filed FILENAME.
 */
export function resolveDocType(row: {
  manualDocType?: string | null;
  aiDocType?: string | null;
  aiConfidence?: number | null;
}): { code: DocType | null; manual: boolean } {
  const manual = row.manualDocType;
  if (manual && manual in DOC_TYPE_LABELS) {
    return { code: manual as DocType, manual: true };
  }
  return {
    code: trustedDocTypeCode(row.aiDocType, row.aiConfidence),
    manual: false,
  };
}

/**
 * The derived axes for a checklist upload — what the AI plus the engagement
 * imply, before any human override.
 *
 * The year chain is resolveYear's, unchanged: year printed on the document →
 * the engagement's structured tax year → a single unambiguous 20xx in its title
 * → the due date's year → null.
 */
export function deriveBrowseAxes(input: {
  extractedYear: number | null;
  engagementTaxYear: number | null;
  titleYear: number | null;
  dueDate: string | null;
  aiDocType: string | null;
  aiConfidence: number | null;
}): BrowseAxes {
  return {
    year: resolveYear({
      extractedYear: input.extractedYear,
      engagementTaxYear: input.engagementTaxYear,
      titleYear: input.titleYear,
      dueDate: input.dueDate,
    }),
    category: categoryForDocType(
      trustedDocTypeCode(input.aiDocType, input.aiConfidence),
    ),
  };
}

/** The stored axis state of a row, as the database holds it. */
export type StoredAxes = {
  browseYear: number | null;
  browseCategory: string | null;
  browseYearManual: boolean;
  browseCategoryManual: boolean;
};

/** A partial DB patch in snake_case, ready to hand to a Supabase update. */
export type AxesPatch = {
  browse_year?: number | null;
  browse_category?: string | null;
};

/**
 * THE INVARIANT THIS MODULE EXISTS FOR.
 *
 * Re-classification must never undo a human. An accountant who moves a file to
 * 2023 has made a decision the model does not get a vote on — and a document is
 * re-classified more often than people expect (a re-upload, a retry after a
 * transient model failure, a backfill). Without this guard, hand-sorting a
 * client's files would silently unwind itself hours later, which is the single
 * most corrosive bug a filing product can have: the user cannot see it happen
 * and stops trusting every folder.
 *
 * So each axis is independent: someone can fix the year and leave the category
 * to the model, and the model keeps updating only what nobody has claimed.
 * Returns only the columns that should actually change.
 */
export function applyDerivedAxes(
  stored: StoredAxes,
  derived: BrowseAxes,
): AxesPatch {
  const patch: AxesPatch = {};
  if (!stored.browseYearManual && stored.browseYear !== derived.year) {
    patch.browse_year = derived.year;
  }
  if (
    !stored.browseCategoryManual &&
    stored.browseCategory !== derived.category
  ) {
    patch.browse_category = derived.category;
  }
  return patch;
}

// ── Import-time year prefill ────────────────────────────────────────────────

/**
 * Read a year out of the folder path an imported file came from.
 *
 * Historical files are almost never unsorted on disk — a firm bringing in ten
 * years of work usually has "Tremblay Inc/2023/Slips/t4.pdf" already. That
 * folder name IS their existing organization, and throwing it away would dump
 * everything into Unsorted and make the accountant retype what they already
 * knew. This is plain string parsing: no model, no cost, no network.
 *
 * Deepest segment first, because it is the most specific ("2023/Corrected"
 * beats a top-level "2020-2024 archive"). A segment naming two years is
 * ambiguous and is skipped rather than guessed — the same rule
 * expectedYearFromTitle applies to engagement titles, and for the same reason:
 * a wrong year filed confidently is worse than an honest Unsorted.
 *
 * The FILENAME is deliberately not read. "t4-2023.pdf" looks tempting, but
 * invoice and statement filenames are full of numbers that are not tax years
 * (order ids, phone numbers, "2024" in an address), and a wrong year here lands
 * silently on thousands of files at once.
 */
export function yearFromSourcePath(path: string | null | undefined): number | null {
  if (!path) return null;
  const segments = path
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Drop the filename — folders only (see the doc comment).
  const folders = segments.slice(0, -1);
  for (let i = folders.length - 1; i >= 0; i--) {
    const found = folders[i].match(/\b(19|20)\d{2}\b/g);
    if (!found || found.length !== 1) continue;
    const y = Number(found[0]);
    if (y >= 1990 && y <= 2100) return y;
  }
  return null;
}
