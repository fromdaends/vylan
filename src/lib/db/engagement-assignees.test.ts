import { describe, it, expect } from "vitest";

import { resolveAssignees } from "./engagement-assignees";

// The union rule is the whole feature's load-bearing piece: `assigned_user_id`
// survives as the primary, engagement_assignees (1540) holds the set, and every
// surface must show one coherent list however those two disagree.
describe("resolveAssignees", () => {
  // ⚠️ THE ONE THAT PROTECTS PRODUCTION. Every engagement that exists today has
  // a primary and NO rows in the new table, and while 1540 is unapplied the
  // reader returns an empty Map for all of them. If this returned [] the whole
  // app would show every job as unassigned the moment the code shipped —
  // silently, and everywhere at once.
  it("reads a pre-1540 engagement as its single assignee", () => {
    expect(resolveAssignees("u-tyler", undefined)).toEqual(["u-tyler"]);
    expect(resolveAssignees("u-tyler", [])).toEqual(["u-tyler"]);
  });

  it("puts the primary first, then the rest in the order they were added", () => {
    expect(resolveAssignees("u-tyler", ["u-zach", "u-clarence"])).toEqual([
      "u-tyler",
      "u-zach",
      "u-clarence",
    ]);
  });

  // The primary is expected to ALSO have a row once 1540 is live. They must not
  // appear twice, or the card draws the same face beside itself.
  it("never shows the primary twice when the table also holds them", () => {
    expect(resolveAssignees("u-tyler", ["u-tyler", "u-zach"])).toEqual([
      "u-tyler",
      "u-zach",
    ]);
    // Even if the table lists them somewhere other than first.
    expect(resolveAssignees("u-tyler", ["u-zach", "u-tyler"])).toEqual([
      "u-tyler",
      "u-zach",
    ]);
  });

  it("survives an engagement with assignees but no primary", () => {
    expect(resolveAssignees(null, ["u-zach"])).toEqual(["u-zach"]);
  });

  it("is empty only when nothing is set anywhere", () => {
    expect(resolveAssignees(null, [])).toEqual([]);
    expect(resolveAssignees(undefined, undefined)).toEqual([]);
  });

  it("drops duplicates and blanks the database should never contain anyway", () => {
    expect(resolveAssignees(null, ["u-zach", "u-zach", ""])).toEqual(["u-zach"]);
  });
});
