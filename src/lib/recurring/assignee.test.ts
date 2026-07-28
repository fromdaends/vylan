import { describe, it, expect } from "vitest";
import { resolveSeriesAssignee } from "./assignee";

const ACTIVE = new Set(["sarah", "marc", "owner-1"]);

describe("resolveSeriesAssignee", () => {
  it("keeps the series' own assignee when they're still active", () => {
    expect(
      resolveSeriesAssignee({
        assignedUserId: "sarah",
        createdByUserId: "marc",
        activeUserIds: ACTIVE,
        fallbackOwnerId: "owner-1",
      }),
    ).toBe("sarah");
  });

  it("falls through to the creator on a pre-0940 row (no assignee column)", () => {
    // Deploy-ahead-of-SQL: the read has no assigned_user_id at all. Behaviour
    // must be byte-identical to the old hardcoded created_by_user_id.
    expect(
      resolveSeriesAssignee({
        assignedUserId: undefined,
        createdByUserId: "marc",
        activeUserIds: ACTIVE,
        fallbackOwnerId: "owner-1",
      }),
    ).toBe("marc");
  });

  it("does NOT assign to a deactivated person — this is the bug", () => {
    // Sarah left. Before 0940 this returned "sarah" every cycle, forever.
    expect(
      resolveSeriesAssignee({
        assignedUserId: "sarah-gone",
        createdByUserId: "sarah-gone",
        activeUserIds: ACTIVE,
        fallbackOwnerId: "owner-1",
      }),
    ).toBe("owner-1");
  });

  it("prefers the assignee over the creator when both are active", () => {
    // Guarded offboarding moved the series to Marc; the creator is irrelevant.
    expect(
      resolveSeriesAssignee({
        assignedUserId: "marc",
        createdByUserId: "sarah",
        activeUserIds: ACTIVE,
        fallbackOwnerId: "owner-1",
      }),
    ).toBe("marc");
  });

  it("falls back to the owner when the series was never assigned to anyone", () => {
    expect(
      resolveSeriesAssignee({
        assignedUserId: null,
        createdByUserId: null,
        activeUserIds: ACTIVE,
        fallbackOwnerId: "owner-1",
      }),
    ).toBe("owner-1");
  });

  it("returns null rather than a ghost when no active owner resolves", () => {
    expect(
      resolveSeriesAssignee({
        assignedUserId: "sarah-gone",
        createdByUserId: "marc-gone",
        activeUserIds: new Set(),
        fallbackOwnerId: null,
      }),
    ).toBeNull();
  });

  it("returns null when the fallback owner is themselves deactivated", () => {
    // A deactivated owner must not be handed work either.
    expect(
      resolveSeriesAssignee({
        assignedUserId: "sarah-gone",
        createdByUserId: null,
        activeUserIds: new Set(["marc"]),
        fallbackOwnerId: "owner-gone",
      }),
    ).toBeNull();
  });

  it("treats an empty-string id as absent rather than matching", () => {
    expect(
      resolveSeriesAssignee({
        assignedUserId: "",
        createdByUserId: "marc",
        activeUserIds: ACTIVE,
        fallbackOwnerId: "owner-1",
      }),
    ).toBe("marc");
  });
});
