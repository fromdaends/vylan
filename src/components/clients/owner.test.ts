import { describe, it, expect } from "vitest";
import { filterClientsByOwner, OWNER_FILTERS } from "./owner";

type Row = { id: string; assigned_user_id: string | null };

const me = "user-1";
const rows: Row[] = [
  { id: "a", assigned_user_id: "user-1" },
  { id: "b", assigned_user_id: "user-2" },
  { id: "c", assigned_user_id: null },
  { id: "d", assigned_user_id: "user-1" },
];

describe("filterClientsByOwner", () => {
  it("returns everything for 'all' (pass-through, same reference semantics)", () => {
    expect(filterClientsByOwner(rows, "all", me)).toEqual(rows);
  });

  it("keeps only the current user's clients for 'mine'", () => {
    const mine = filterClientsByOwner(rows, "mine", me);
    expect(mine.map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("never matches unassigned clients under 'mine'", () => {
    const mine = filterClientsByOwner(rows, "mine", me);
    expect(mine.some((r) => r.assigned_user_id === null)).toBe(false);
  });

  it("returns an empty list when the user owns nothing", () => {
    expect(filterClientsByOwner(rows, "mine", "user-999")).toEqual([]);
  });

  it("exposes exactly the two supported filters", () => {
    expect(OWNER_FILTERS).toEqual(["all", "mine"]);
  });
});
