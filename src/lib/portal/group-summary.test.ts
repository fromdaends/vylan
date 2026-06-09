import { describe, it, expect } from "vitest";
import { summarizeSignatures, summarizeDocuments } from "./group-summary";
import type { RequestItem, RequestItemStatus } from "@/lib/db/request-items";

function makeItem(over: Partial<RequestItem> = {}): RequestItem {
  return {
    id: "i1",
    engagement_id: "eng-1",
    label: "Item",
    label_fr: null,
    description: null,
    description_fr: null,
    doc_type: "other",
    required: true,
    order_index: 0,
    status: "pending",
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    ai_rejection_count: 0,
    kind: "collection",
    signing_doc_path: null,
    signing_doc_name: null,
    signing_doc_mime: null,
    created_at: "2026-06-08T00:00:00Z",
    ...over,
  };
}

function sigs(statuses: RequestItemStatus[]): RequestItem[] {
  return statuses.map((status, i) =>
    makeItem({ id: `s${i}`, kind: "signature", status }),
  );
}

describe("summarizeSignatures", () => {
  it("is 'none' when there are no signature items", () => {
    expect(summarizeSignatures([])).toEqual({ kind: "none" });
  });

  it("counts pending + rejected as still 'to sign'", () => {
    expect(summarizeSignatures(sigs(["pending", "rejected", "approved"]))).toEqual(
      { kind: "to_sign", count: 2 },
    );
  });

  it("is 'in_review' when none to sign but some submitted", () => {
    expect(summarizeSignatures(sigs(["submitted", "approved"]))).toEqual({
      kind: "in_review",
      count: 1,
    });
  });

  it("prefers 'to sign' over 'in review' when both are present", () => {
    expect(summarizeSignatures(sigs(["pending", "submitted"]))).toEqual({
      kind: "to_sign",
      count: 1,
    });
  });

  it("is 'all_signed' when every item is approved", () => {
    expect(summarizeSignatures(sigs(["approved", "approved"]))).toEqual({
      kind: "all_signed",
    });
  });
});

describe("summarizeDocuments", () => {
  it("is 'none' when there are no document items", () => {
    expect(summarizeDocuments([])).toEqual({ kind: "none" });
  });

  it("counts rejected items as needing attention", () => {
    const items = [
      makeItem({ id: "a", status: "rejected" }),
      makeItem({ id: "b", status: "approved" }),
    ];
    expect(summarizeDocuments(items)).toEqual({
      kind: "needs_attention",
      count: 1,
    });
  });

  it("treats a pending item with a recorded reason (AI auto-reject) as needing attention", () => {
    const items = [
      makeItem({ id: "a", status: "pending", rejection_reason: "Too blurry to read" }),
    ];
    expect(summarizeDocuments(items)).toEqual({
      kind: "needs_attention",
      count: 1,
    });
  });

  it("reports outstanding progress (done of total) when some remain", () => {
    const items = [
      makeItem({ id: "a", status: "approved" }),
      makeItem({ id: "b", status: "submitted" }),
      makeItem({ id: "c", status: "pending" }),
    ];
    expect(summarizeDocuments(items)).toEqual({
      kind: "outstanding",
      done: 1,
      total: 3,
    });
  });

  it("counts 'na' as done for the progress tally", () => {
    const items = [
      makeItem({ id: "a", status: "approved" }),
      makeItem({ id: "b", status: "na" }),
    ];
    expect(summarizeDocuments(items)).toEqual({ kind: "all_set" });
  });

  it("is 'all_set' when every document is approved or n/a", () => {
    const items = [makeItem({ status: "approved" })];
    expect(summarizeDocuments(items)).toEqual({ kind: "all_set" });
  });

  it("prioritizes needs_attention over outstanding", () => {
    const items = [
      makeItem({ id: "a", status: "rejected" }),
      makeItem({ id: "b", status: "pending" }),
    ];
    expect(summarizeDocuments(items)).toEqual({
      kind: "needs_attention",
      count: 1,
    });
  });
});
