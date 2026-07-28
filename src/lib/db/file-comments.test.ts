import { describe, it, expect } from "vitest";
import { groupEngagementComments, type FileComment } from "./file-comments";

function c(over: Partial<FileComment>): FileComment {
  return {
    id: "c0",
    uploadedFileId: null,
    requestItemId: null,
    authorUserId: "u1",
    authorName: "Tyler",
    body: "note",
    mentions: [],
    createdAt: "2026-07-28T10:00:00Z",
    ...over,
  };
}

// PURE split of an engagement's flat comment list into its three target
// buckets (files / checklist items / the engagement itself).
describe("groupEngagementComments", () => {
  it("routes each comment to its target bucket", () => {
    const grouped = groupEngagementComments([
      c({ id: "c1", uploadedFileId: "f1" }),
      c({ id: "c2", requestItemId: "i1" }),
      c({ id: "c3" }),
      c({ id: "c4", uploadedFileId: "f1" }),
      c({ id: "c5", requestItemId: "i2" }),
    ]);
    expect(grouped.byFile.get("f1")?.map((x) => x.id)).toEqual(["c1", "c4"]);
    expect(grouped.byItem.get("i1")?.map((x) => x.id)).toEqual(["c2"]);
    expect(grouped.byItem.get("i2")?.map((x) => x.id)).toEqual(["c5"]);
    expect(grouped.engagement.map((x) => x.id)).toEqual(["c3"]);
  });

  it("keeps input order inside each bucket (the query sorts oldest-first)", () => {
    const grouped = groupEngagementComments([
      c({ id: "old", requestItemId: "i1", createdAt: "2026-07-01T00:00:00Z" }),
      c({ id: "new", requestItemId: "i1", createdAt: "2026-07-02T00:00:00Z" }),
    ]);
    expect(grouped.byItem.get("i1")?.map((x) => x.id)).toEqual(["old", "new"]);
  });

  it("returns empty structures for an empty list", () => {
    const grouped = groupEngagementComments([]);
    expect(grouped.byFile.size).toBe(0);
    expect(grouped.byItem.size).toBe(0);
    expect(grouped.engagement).toEqual([]);
  });

  it("a file comment never lands in the item bucket even if both ids exist", () => {
    // The DB CHECK forbids both-set rows, but the fold should still be
    // deterministic if one ever appeared: file wins.
    const grouped = groupEngagementComments([
      c({ id: "cx", uploadedFileId: "f1", requestItemId: "i1" }),
    ]);
    expect(grouped.byFile.get("f1")?.length).toBe(1);
    expect(grouped.byItem.size).toBe(0);
  });
});
