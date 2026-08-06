// The board's per-card numbers, in a module that touches NOTHING server-side.
//
// ── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
//
// These live next to the reader that produces them, which is the obvious place
// — and it broke the production build. `lib/db/engagement-board.ts` imports
// `getServerSupabase`, which imports `next/headers`; importing even a TYPE and
// a frozen constant from it pulled that whole chain into a "use client"
// component and Turbopack refused the build.
//
// This repo has been bitten by the mirror image of this before (a constant
// exported from a "use client" file silently becoming a stub in a Server
// Component). The rule that avoids both: values shared across the boundary go
// in a module that imports neither side.

export type BoardNumbers = {
  /** Planned minutes, or null when nothing can say. NULL IS NOT ZERO — an
   *  unbudgeted job renders "—", because "0h planned" is a claim nobody made
   *  and it would inflate the board's Remaining. */
  budgetMinutes: number | null;
  /** Minutes actually worked, summed from time_entries. Zero is honest here. */
  actualMinutes: number;
  /** Manual position in its column. Null = never dragged. */
  boardRank: number | null;
};

/** What a card falls back to: before migration 1790 has run, and for any id
 *  the reader did not return. The board is fully usable in this state — it
 *  simply has no hours to show. */
export const EMPTY_BOARD_NUMBERS: BoardNumbers = {
  budgetMinutes: null,
  actualMinutes: 0,
  boardRank: null,
};
