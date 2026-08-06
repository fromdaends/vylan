import { describe, it, expect } from "vitest";
import {
  dropIndexFor,
  rankForDrop,
  sortColumn,
  type RankedCard,
} from "./board-rank";

const card = (id: string, boardRank: number | null): RankedCard => ({
  id,
  boardRank,
});

describe("sortColumn", () => {
  it("puts ranked cards first, in rank order", () => {
    const out = sortColumn([card("c", 30), card("a", 10), card("b", 20)]);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps never-dragged cards in the order they arrived, after the ranked", () => {
    // The list already sorted these by due date. A board that reshuffled them
    // would look like it had scrambled the column the first time anyone dragged
    // anything.
    const out = sortColumn([
      card("untouched-1", null),
      card("dragged", 5),
      card("untouched-2", null),
    ]);
    expect(out.map((x) => x.id)).toEqual([
      "dragged",
      "untouched-1",
      "untouched-2",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [card("b", 2), card("a", 1)];
    sortColumn(input);
    expect(input.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("rankForDrop", () => {
  it("takes the midpoint between two neighbours", () => {
    const col = [card("a", 100), card("b", 200)];
    expect(rankForDrop(col, 1)).toBe(150);
  });

  it("goes above the first card when dropped at the top", () => {
    const col = [card("a", 100), card("b", 200)];
    expect(rankForDrop(col, 0)).toBeLessThan(100);
  });

  it("goes below the last card when dropped at the bottom", () => {
    const col = [card("a", 100), card("b", 200)];
    expect(rankForDrop(col, 2)).toBeGreaterThan(200);
  });

  it("handles an empty column", () => {
    expect(Number.isFinite(rankForDrop([], 0))).toBe(true);
  });

  it("handles a column nobody has ever dragged in", () => {
    const col = [card("a", null), card("b", null)];
    expect(Number.isFinite(rankForDrop(col, 1))).toBe(true);
  });

  it("survives repeated bisection of the same gap", () => {
    // Twenty drops into the same slot. The point of fractional ranks is that
    // this never has to renumber the column — so the order must still hold.
    let col = [card("top", 0), card("bottom", 1024)];
    for (let i = 0; i < 20; i++) {
      const r = rankForDrop(col, 1);
      expect(r).toBeGreaterThan(col[0].boardRank!);
      expect(r).toBeLessThan(col[col.length - 1].boardRank!);
      col = [col[0], card(`mid-${i}`, r), ...col.slice(1)];
    }
    const ranks = sortColumn(col).map((c) => c.boardRank!);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

describe("dropIndexFor", () => {
  const rects = [
    { top: 0, height: 100 },
    { top: 110, height: 100 },
    { top: 220, height: 100 },
  ];

  it("lands at 0 above the first card's midpoint", () => {
    expect(dropIndexFor(rects, 10)).toBe(0);
    expect(dropIndexFor(rects, 49)).toBe(0);
  });

  it("moves on crossing a MIDPOINT, not a top edge", () => {
    // 105 is past card 0's midpoint (50) but before card 1's top (110). Using
    // the top edge here would keep the placeholder a card behind the pointer.
    expect(dropIndexFor(rects, 105)).toBe(1);
    expect(dropIndexFor(rects, 165)).toBe(2);
  });

  it("lands at the end below the last midpoint", () => {
    expect(dropIndexFor(rects, 500)).toBe(3);
  });

  it("says 0 for an empty column", () => {
    expect(dropIndexFor([], 400)).toBe(0);
  });
});
