import { describe, it, expect } from "vitest";
import { groupEngagementComments, type FileComment } from "./file-comments";

function c(over: Partial<FileComment>): FileComment {
  return {
    id: "c0",
    uploadedFileId: null,
    requestItemId: null,
    engagementTaskId: null,
    clientId: null,
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

// The 1520 targets. The important one is the LAST test: before task comments
// had their own bucket, "no file and no item" meant "on the engagement", and a
// task comment carries the engagement_id (so mention links resolve) — so it
// arrived in the same query and silently joined the engagement's own thread.
describe("groupEngagementComments — tasks (1520)", () => {
  it("buckets a task comment by its task", () => {
    const grouped = groupEngagementComments([
      c({ id: "t1", engagementTaskId: "task-a" }),
      c({ id: "t2", engagementTaskId: "task-a" }),
      c({ id: "t3", engagementTaskId: "task-b" }),
    ]);
    expect(grouped.byTask.get("task-a")?.map((x) => x.id)).toEqual(["t1", "t2"]);
    expect(grouped.byTask.get("task-b")?.map((x) => x.id)).toEqual(["t3"]);
  });

  it("keeps a task comment OUT of the engagement thread", () => {
    const grouped = groupEngagementComments([
      c({ id: "eng", }),
      c({ id: "onTask", engagementTaskId: "task-a" }),
    ]);
    // Only the genuinely engagement-level one is in the engagement thread.
    expect(grouped.engagement.map((x) => x.id)).toEqual(["eng"]);
    expect(grouped.byTask.get("task-a")?.map((x) => x.id)).toEqual(["onTask"]);
  });

  it("keeps a client comment out of every engagement bucket", () => {
    const grouped = groupEngagementComments([
      c({ id: "onClient", clientId: "cl-1" }),
    ]);
    expect(grouped.engagement).toEqual([]);
    expect(grouped.byTask.size).toBe(0);
    expect(grouped.byFile.size).toBe(0);
    expect(grouped.byItem.size).toBe(0);
  });
});
