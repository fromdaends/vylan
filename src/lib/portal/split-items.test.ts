import { describe, it, expect } from "vitest";
import { splitPortalItems, portalChecklist, isAnswered } from "./split-items";
import type { RequestItem } from "@/lib/db/request-items";

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
    ai_set_assessment: null,
    answer_text: null,
    answered_at: null,
    created_at: "2026-06-08T00:00:00Z",
    ...over,
  };
}

describe("splitPortalItems", () => {
  it("separates signature items from collection items", () => {
    const items = [
      makeItem({ id: "a", kind: "collection" }),
      makeItem({ id: "b", kind: "signature" }),
      makeItem({ id: "c", kind: "collection" }),
      makeItem({ id: "d", kind: "signature" }),
    ];
    const { collection, signatures } = splitPortalItems(items);
    expect(collection.map((i) => i.id)).toEqual(["a", "c"]);
    expect(signatures.map((i) => i.id)).toEqual(["b", "d"]);
  });

  it("preserves order within each group", () => {
    const items = [
      makeItem({ id: "s1", kind: "signature", order_index: 0 }),
      makeItem({ id: "c1", kind: "collection", order_index: 1 }),
      makeItem({ id: "s2", kind: "signature", order_index: 2 }),
    ];
    const { collection, signatures } = splitPortalItems(items);
    expect(signatures.map((i) => i.id)).toEqual(["s1", "s2"]);
    expect(collection.map((i) => i.id)).toEqual(["c1"]);
  });

  it("returns all items as collection when there are no signatures (common case)", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    const { collection, signatures } = splitPortalItems(items);
    expect(collection).toHaveLength(2);
    expect(signatures).toHaveLength(0);
  });

  it("returns empty groups for an empty list", () => {
    const { collection, signatures, questions } = splitPortalItems([]);
    expect(collection).toEqual([]);
    expect(signatures).toEqual([]);
    expect(questions).toEqual([]);
  });

  it("keeps questions out of the document group", () => {
    // Not because they go somewhere else — they stay in the same list — but
    // because a dropzone is the wrong control for "what was this for?".
    const items = [
      makeItem({ id: "a", kind: "collection" }),
      makeItem({ id: "q", kind: "question" }),
      makeItem({ id: "s", kind: "signature" }),
    ];
    const { collection, signatures, questions } = splitPortalItems(items);
    expect(collection.map((i) => i.id)).toEqual(["a"]);
    expect(questions.map((i) => i.id)).toEqual(["q"]);
    expect(signatures.map((i) => i.id)).toEqual(["s"]);
  });
});

describe("portalChecklist", () => {
  it("keeps documents and questions together, in the firm's order", () => {
    // The firm decides what to ask for first. A question about the March bank
    // charge belongs where it was put, not after every document because
    // questions happened to be a later feature.
    const items = [
      makeItem({ id: "q1", kind: "question" }),
      makeItem({ id: "d1", kind: "collection" }),
      makeItem({ id: "s1", kind: "signature" }),
      makeItem({ id: "q2", kind: "question" }),
    ];
    expect(portalChecklist(items).map((i) => i.id)).toEqual([
      "q1",
      "d1",
      "q2",
    ]);
  });

  it("is the whole list when there are no signatures", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    expect(portalChecklist(items)).toHaveLength(2);
  });
});

describe("isAnswered", () => {
  it("is the words, not the status", () => {
    // An accountant or a reminder can move an item's status. Only the client
    // can put words in answer_text, so that is what "answered" reads.
    expect(isAnswered(makeItem({ kind: "question" }))).toBe(false);
    expect(
      isAnswered(makeItem({ kind: "question", status: "submitted" })),
    ).toBe(false);
    expect(
      isAnswered(
        makeItem({ kind: "question", answer_text: "Deposit for the Laval job" }),
      ),
    ).toBe(true);
  });

  it("treats whitespace as no answer", () => {
    expect(isAnswered(makeItem({ kind: "question", answer_text: "   " }))).toBe(
      false,
    );
  });
});
