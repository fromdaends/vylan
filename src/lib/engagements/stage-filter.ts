// Stage filtering + stage sorting for the Active engagements table.
//
// PURE (no I/O, no React) so the rules are unit-tested directly and the view
// component stays a thin renderer. Scoped to the Active view by its caller —
// the Overview's table shares the same WorklistTable but never passes these in.
//
// The row shape is structural (just the two fields these rules read) rather
// than the full WorklistRow, so the tests don't have to build a 25-field
// fixture to assert a sort order.

import {
  ENGAGEMENT_STAGES,
  stageIndex,
  isEngagementStage,
  type EngagementStage,
} from "./stage";

// The stages a filter chip is offered for: every stage EXCEPT completed.
// A completed engagement's lifecycle status is 'complete', so it lives in the
// Completed sub-page, not this one — a chip here would always read 0 and, if it
// ever didn't, would only surface a row that shouldn't be in Active anyway.
export const FILTERABLE_STAGES: EngagementStage[] = ENGAGEMENT_STAGES.filter(
  (s) => s !== "completed",
);

// The slice of a row these rules read. A full WorklistRow satisfies it.
export type StageFilterRow = {
  stage?: EngagementStage | null;
  // Most recent of (last client upload, sent_at, created_at). ISO 8601, so a
  // lexicographic compare is chronological. The table's default order and the
  // tie-break within a stage.
  recencyAt: string;
};

export type StageSortDir = "asc" | "desc";

// How many rows sit at each stage. Counts EVERY stage (not just the filterable
// ones) so a caller can't silently miss one; the chip row decides what to show.
//
// IMPORTANT: pass the rows with every OTHER filter already applied (scope +
// search) but NOT the stage filter itself. That way each chip's count is
// exactly what clicking it would reveal, and selecting one chip doesn't zero
// all the others.
export function countByStage(
  rows: StageFilterRow[],
): Record<EngagementStage, number> {
  const out = Object.fromEntries(ENGAGEMENT_STAGES.map((s) => [s, 0])) as Record<
    EngagementStage,
    number
  >;
  for (const r of rows) {
    if (r.stage) out[r.stage] += 1;
  }
  return out;
}

// Narrow rows to one stage. A null stage never matches — a draft has no
// workflow position, so it can't be "at" one.
export function filterRowsByStage<T extends StageFilterRow>(
  rows: T[],
  stage: EngagementStage | null,
): T[] {
  if (!stage) return rows;
  return rows.filter((r) => r.stage === stage);
}

// Sort by workflow position. Ties (same stage) fall back to the table's default
// order — newest first — so a filtered or sorted view still reads sensibly
// inside a stage instead of scrambling.
//
// Rows with NO stage (drafts live in the Active view too) always sort LAST, in
// both directions. They aren't at a point in the workflow, so ordering them
// against stages would be inventing a position they don't have — and putting
// them first in `desc` would bury the finished work the sort was reaching for.
export function sortRowsByStage<T extends StageFilterRow>(
  rows: T[],
  dir: StageSortDir,
): T[] {
  const byRecency = (a: T, b: T) => b.recencyAt.localeCompare(a.recencyAt);
  return [...rows].sort((a, b) => {
    if (!a.stage && !b.stage) return byRecency(a, b);
    if (!a.stage) return 1;
    if (!b.stage) return -1;
    const delta = stageIndex(a.stage) - stageIndex(b.stage);
    if (delta !== 0) return dir === "asc" ? delta : -delta;
    return byRecency(a, b);
  });
}

// ── URL params ──────────────────────────────────────────────────────────────
// The filter + sort live in the query string so a view can be bookmarked,
// shared, and survives navigating into an engagement and back (the browser
// restores the URL). Both parsers are total: anything unrecognised reads as
// "not set" rather than throwing, so a hand-edited or stale link degrades to
// the default view instead of an error page.

export const STAGE_PARAM = "stage";
export const SORT_PARAM = "sort";
export const DIR_PARAM = "dir";
// The only sortable column today. Named (rather than implied) so adding a
// second sortable column later doesn't need a URL migration.
export const SORT_STAGE = "stage";

// The stage filter from ?stage=… — only a stage that actually has a chip counts,
// so ?stage=completed (no chip) reads as no filter rather than an empty table
// nothing can clear.
export function parseStageFilter(raw: string | null | undefined): EngagementStage | null {
  if (!raw || !isEngagementStage(raw)) return null;
  return FILTERABLE_STAGES.includes(raw) ? raw : null;
}

// The sort direction from ?sort=stage&dir=… — null when the table isn't
// stage-sorted (the default: newest first). A dir without the matching sort key
// is ignored, so a stray ?dir=asc can't silently reorder the table.
export function parseStageSort(
  sort: string | null | undefined,
  dir: string | null | undefined,
): StageSortDir | null {
  if (sort !== SORT_STAGE) return null;
  return dir === "desc" ? "desc" : dir === "asc" ? "asc" : null;
}

// Clicking the Status header cycles asc → desc → off.
//
// The spec asked for an ascending/descending toggle; the third step back to the
// default matters because the default (newest first) is otherwise unreachable
// without a reload — a two-state toggle would trap the accountant in a sort
// they only wanted to peek at.
export function nextStageSort(current: StageSortDir | null): StageSortDir | null {
  if (current === null) return "asc";
  if (current === "asc") return "desc";
  return null;
}
