import { describe, it, expect } from "vitest";
import { splitPortalItems } from "./split-items";
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
    const { collection, signatures } = splitPortalItems([]);
    expect(collection).toEqual([]);
    expect(signatures).toEqual([]);
  });
});
