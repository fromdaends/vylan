// Where a card sits in its column, and what happens when you drop one.
//
// ── WHY RANKS ARE FRACTIONAL ───────────────────────────────────────────────
//
// Dropping a card between two neighbours takes the MIDPOINT of their ranks.
// One row is written, not the whole column — which matters because a drop is
// optimistic: the fewer rows a drop touches, the less there is to roll back
// when the write fails, and the less chance two people dragging in the same
// column overwrite each other's order.
//
// Integers cannot do this. Between 1 and 2 there is nothing, so an integer
// scheme has to renumber the column on every drop.
//
// ── WHY NULL IS A REAL RANK ────────────────────────────────────────────────
//
// Every engagement that existed before this board did has `board_rank = null`,
// and that is not "rank zero". It means nobody has ever expressed an opinion
// about where this card goes, so it keeps the ordering the list already gives
// it (due date, then recency). Ranked cards float to the top of the column in
// their chosen order; unranked ones follow in the order they always had.
//
// The alternative — backfilling every row with a rank on migration — would have
// frozen today's accidental order into a deliberate one, and the first drag
// would have looked like it scrambled the column.

/** A card as the ordering cares about it. */
export type RankedCard = {
  id: string;
  boardRank: number | null;
};

/** The gap used when a column has no ranks at all yet. Large so the first few
 *  drops have room to bisect without reaching for tiny fractions. */
const STEP = 1024;

/**
 * The rank a card must take to land at `index` in `column`.
 *
 * `column` MUST already exclude the card being moved — a card cannot be its own
 * neighbour, and leaving it in produces a rank equal to its current one, which
 * reads as "the drop did nothing".
 */
export function rankForDrop(column: RankedCard[], index: number): number {
  const ranks = column.map((c) => c.boardRank);
  const before = index > 0 ? ranks[index - 1] : null;
  const after = index < ranks.length ? ranks[index] : null;

  // Between two ranked neighbours: the midpoint.
  if (before != null && after != null) return (before + after) / 2;
  // Landing at the top of ranked cards: a step above the first.
  if (before == null && after != null) return after - STEP;
  // Landing after the last ranked card — or anywhere in a column whose cards
  // are all unranked, which is the same thing: a step below the last rank.
  if (before != null) return before + STEP;
  // An entirely unranked column. Any finite number works; 0 keeps the numbers
  // readable when somebody looks at the row in the database.
  return 0;
}

/**
 * Column order: ranked cards first in rank order, then unranked ones in the
 * order they arrived (which the caller has already sorted meaningfully).
 *
 * STABLE for the unranked tail — `Array.prototype.sort` is stable in every
 * engine this runs on, and relying on that is what keeps an untouched column
 * looking exactly as it did before the board existed.
 */
export function sortColumn<T extends RankedCard>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    if (a.boardRank == null && b.boardRank == null) return 0;
    // Nulls last, always: a dragged card is an expressed preference and
    // outranks one nobody has touched.
    if (a.boardRank == null) return 1;
    if (b.boardRank == null) return -1;
    return a.boardRank - b.boardRank;
  });
}

/**
 * Where the pointer says the card should land: the number of cards whose
 * vertical MIDPOINT is above it.
 *
 * Midpoint rather than top edge, per the handoff — crossing half a card is when
 * the placeholder should move, and using the top edge makes the placeholder
 * jump a card early on the way down and a card late on the way up.
 *
 * `rects` must exclude the dragged card, for the same reason `rankForDrop` does.
 */
export function dropIndexFor(
  rects: { top: number; height: number }[],
  pointerY: number,
): number {
  let index = 0;
  for (const r of rects) {
    if (pointerY > r.top + r.height / 2) index += 1;
  }
  return index;
}
