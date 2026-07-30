import { describe, it, expect } from "vitest";
import { setReadWouldAddNothing } from "./set-assessment";

// The whole-item read is a SECOND paid pass over documents the per-file read
// already saw. It earns its cost only when there is something to compare
// ACROSS: missing pages, balances that should chain, an uncovered month.
//
// The founder's correction that shaped this rule: "if it's a multipage PDF, it
// would have that one check this item is a multipage" — a single 12-page PDF is
// a set, and skipping it would throw away exactly the analysis it exists for.

const f = (pageCount: number | null) => ({ pageCount });

describe("setReadWouldAddNothing", () => {
  it("skips one single-page file — nothing to compare it against", () => {
    expect(setReadWouldAddNothing([f(1)], false)).toBe(true);
  });

  // THE CORRECTION. This must never become true.
  it("NEVER skips a multi-page PDF, however few files there are", () => {
    expect(setReadWouldAddNothing([f(2)], false)).toBe(false);
    expect(setReadWouldAddNothing([f(4)], false)).toBe(false);
    expect(setReadWouldAddNothing([f(12)], false)).toBe(false);
  });

  it("never skips once there are two or more files", () => {
    expect(setReadWouldAddNothing([f(1), f(1)], false)).toBe(false);
    expect(setReadWouldAddNothing([f(1), f(1), f(1)], false)).toBe(false);
  });

  // An unparseable PDF is the file we know LEAST about. Unknown length is not
  // "one page".
  it("does the read when the page count is unknown", () => {
    expect(setReadWouldAddNothing([f(null)], false)).toBe(false);
  });

  it("does the read when the budget left files out — this isn't the set", () => {
    expect(setReadWouldAddNothing([f(1)], true)).toBe(false);
  });

  it("does not skip an empty list (that path clears the summary instead)", () => {
    expect(setReadWouldAddNothing([], false)).toBe(false);
  });

  it("treats a 0-page result as unknown, not as nothing to check", () => {
    expect(setReadWouldAddNothing([f(0)], false)).toBe(false);
  });
});
