// Row selection, shared by every list that can act on many rows at once.
//
// A PLAIN module (no "use server", no "use client"): the cap is read by both
// the server actions and the bars that render them, and a "use server" file may
// export ASYNC FUNCTIONS ONLY — exporting a const from one typechecks, lints
// clean, and then fails the production build. This repo has hit that trap twice
// (see bulk-assign.ts, which this generalises).

/**
 * How many rows one bulk action may touch.
 *
 * Inherited from BULK_ASSIGN_MAX and kept at the same number on purpose. The
 * reasoning there still holds and is the binding constraint: every moved row
 * can write its own activity entry and its own "assigned to you" notification,
 * so a hundred would mean a hundred notifications landing on one person at
 * once. Karbon caps their equivalent at 100; 25 covers the case this exists for
 * — "Clarence is off for two weeks, move his active files" — without turning
 * into a mailbomb.
 *
 * Every action REFUSES past the cap rather than silently truncating. A bulk
 * action that quietly does less than you asked is the worst kind: you cannot
 * tell from the result which half happened.
 */
export const BULK_MAX = 25;

/** Deduplicated, empty-stripped ids — what every bulk action starts from. */
export function normalizeIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export type BulkGuard =
  | { ok: true; ids: string[] }
  | { ok: false; error: "too_many" }
  | { ok: true; ids: string[]; empty: true };

/**
 * The check every bulk action runs first. Pure, so it is unit-testable without
 * a session: the auth and firm checks stay in the action where they belong.
 */
export function guardBulkIds(ids: readonly string[]): BulkGuard {
  const clean = normalizeIds(ids);
  if (clean.length === 0) return { ok: true, ids: clean, empty: true };
  if (clean.length > BULK_MAX) return { ok: false, error: "too_many" };
  return { ok: true, ids: clean };
}

/**
 * Canopy's select-all rule, and deliberately theirs: the header checkbox covers
 * "all VISIBLE tasks" — the rows on screen after filtering — never the whole
 * unseen result set.
 *
 * That is the safe reading. A select-all that silently reaches past what you
 * can see is how somebody archives four hundred rows meaning to archive eight,
 * and no undo makes that a good afternoon.
 */
export function toggleAll(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): Set<string> {
  const allShown = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const next = new Set(selected);
  if (allShown) {
    for (const id of visibleIds) next.delete(id);
  } else {
    for (const id of visibleIds) next.add(id);
  }
  return next;
}

/** Header checkbox state: every visible row ticked, some, or none. */
export function headerState(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): "all" | "some" | "none" {
  if (visibleIds.length === 0) return "none";
  const hits = visibleIds.filter((id) => selected.has(id)).length;
  if (hits === 0) return "none";
  return hits === visibleIds.length ? "all" : "some";
}
