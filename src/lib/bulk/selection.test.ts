import { describe, it, expect } from "vitest";
import {
  BULK_MAX,
  guardBulkIds,
  headerState,
  normalizeIds,
  toggleAll,
} from "./selection";

describe("guardBulkIds — the cap refuses rather than truncating", () => {
  it("deduplicates and strips empties before counting", () => {
    const res = guardBulkIds(["a", "a", "", "b"]);
    expect(res.ok && res.ids).toEqual(["a", "b"]);
  });

  it("allows exactly the cap", () => {
    const ids = Array.from({ length: BULK_MAX }, (_, i) => `t${i}`);
    expect(guardBulkIds(ids).ok).toBe(true);
  });

  // ⚠️ THE POINT OF THE CAP. Truncating would run the action on the first 25
  // and report success, and you could not tell from the result which of your 40
  // rows moved. Refusing is recoverable; a silent partial is not.
  it("REFUSES one past the cap instead of doing the first 25", () => {
    const ids = Array.from({ length: BULK_MAX + 1 }, (_, i) => `t${i}`);
    const res = guardBulkIds(ids);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toBe("too_many");
  });

  it("treats an empty selection as a no-op, not an error", () => {
    const res = guardBulkIds([]);
    expect(res.ok).toBe(true);
    expect(res.ok && "empty" in res && res.empty).toBe(true);
  });

  it("counts DEDUPLICATED ids against the cap", () => {
    // 30 entries, 2 distinct — the same row ticked twice is one row.
    const ids = Array.from({ length: 30 }, () => "a").concat("b");
    expect(guardBulkIds(ids).ok).toBe(true);
    expect(normalizeIds(ids)).toEqual(["a", "b"]);
  });
});

// Canopy's rule, and the safe one: the header checkbox covers the rows ON
// SCREEN after filtering, never the whole unseen result set. A select-all that
// reaches past what you can see is how somebody archives four hundred rows
// meaning to archive eight.
describe("toggleAll — visible rows only", () => {
  it("fills every visible row when none are ticked", () => {
    expect([...toggleAll(["a", "b"], new Set())]).toEqual(["a", "b"]);
  });

  it("clears them when all visible are already ticked", () => {
    expect([...toggleAll(["a", "b"], new Set(["a", "b"]))]).toEqual([]);
  });

  it("fills the rest when only some are ticked", () => {
    expect([...toggleAll(["a", "b"], new Set(["a"]))].sort()).toEqual(["a", "b"]);
  });

  // The selection may hold rows that have since been filtered out. Toggling
  // what is VISIBLE must not silently drop them — that would turn a filter
  // change into an invisible deselection.
  it("leaves off-screen selections alone", () => {
    const next = toggleAll(["a"], new Set(["a", "hidden"]));
    expect(next.has("hidden")).toBe(true);
    expect(next.has("a")).toBe(false);
  });
});

describe("headerState", () => {
  it("is none on an empty list, whatever is selected", () => {
    expect(headerState([], new Set(["ghost"]))).toBe("none");
  });
  it("reports some, all and none", () => {
    expect(headerState(["a", "b"], new Set())).toBe("none");
    expect(headerState(["a", "b"], new Set(["a"]))).toBe("some");
    expect(headerState(["a", "b"], new Set(["a", "b"]))).toBe("all");
  });
  it("ignores selected rows that are not on screen", () => {
    expect(headerState(["a"], new Set(["a", "hidden"]))).toBe("all");
  });
});
