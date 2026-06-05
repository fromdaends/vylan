import { describe, it, expect } from "vitest";
import {
  resolvePreviewStatus,
  buildPreviewDocs,
  previewCounts,
  filterDocs,
} from "./preview-model";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { RequestItem } from "@/lib/db/request-items";
import type { UsabilityVerdict } from "@/lib/ai/usability";

function verdict(usable: boolean): UsabilityVerdict {
  return {
    usable,
    confidence: 0.9,
    primary_issue: usable ? null : "key_fields_obscured",
    all_issues: usable ? [] : ["key_fields_obscured"],
    issue_summary_fr: "",
    issue_summary_en: "",
  };
}

function file(over: Partial<UploadedFile>): UploadedFile {
  return {
    id: "f1",
    request_item_id: "i1",
    engagement_id: "e1",
    storage_path: "p",
    original_filename: "doc.pdf",
    mime_type: "application/pdf",
    size_bytes: 100,
    ai_classification: null,
    ai_confidence: null,
    ai_extracted_fields: null,
    ai_usability: null,
    ai_rejected: false,
    uploaded_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function item(over: Partial<RequestItem>): RequestItem {
  return {
    id: "i1",
    engagement_id: "e1",
    label: "Trial Balance",
    label_fr: null,
    description: null,
    description_fr: null,
    doc_type: "trial_balance",
    required: true,
    order_index: 0,
    status: "submitted",
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    ai_rejection_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("resolvePreviewStatus", () => {
  it("the accountant's approval on the item wins over AI flags", () => {
    expect(resolvePreviewStatus(file({ ai_rejected: true }), "approved")).toBe(
      "approved",
    );
  });
  it("the accountant's rejection on the item wins over an AI-usable verdict", () => {
    expect(
      resolvePreviewStatus(file({ ai_usability: verdict(true) }), "rejected"),
    ).toBe("rejected");
  });
  it("a system auto-reject flag => rejected", () => {
    expect(resolvePreviewStatus(file({ ai_rejected: true }), "submitted")).toBe(
      "rejected",
    );
  });
  it("an AI usable verdict => approved", () => {
    expect(
      resolvePreviewStatus(file({ ai_usability: verdict(true) }), "submitted"),
    ).toBe("approved");
  });
  it("an AI unusable verdict => rejected", () => {
    expect(
      resolvePreviewStatus(file({ ai_usability: verdict(false) }), "submitted"),
    ).toBe("rejected");
  });
  it("no verdict yet => pending (neutral)", () => {
    expect(resolvePreviewStatus(file({}), "pending")).toBe("pending");
  });
});

describe("buildPreviewDocs", () => {
  it("maps files to docs, resolves status, and counts siblings per item", () => {
    const items = [
      item({ id: "i1", status: "submitted" }),
      item({ id: "i2", status: "approved" }),
    ];
    const uploads = [
      file({ id: "a", request_item_id: "i1", ai_usability: verdict(false) }),
      file({ id: "b", request_item_id: "i1", ai_usability: verdict(true) }),
      file({ id: "c", request_item_id: "i2" }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    expect(docs).toHaveLength(3);

    const a = docs.find((d) => d.fileId === "a")!;
    expect(a.status).toBe("rejected");
    expect(a.siblingCount).toBe(2);

    const c = docs.find((d) => d.fileId === "c")!;
    expect(c.status).toBe("approved"); // item is approved -> all its files green
    expect(c.siblingCount).toBe(1);
  });

  it("defaults a file whose item is missing to pending", () => {
    const docs = buildPreviewDocs([file({ request_item_id: "ghost" })], []);
    expect(docs[0].status).toBe("pending");
    expect(docs[0].itemStatus).toBe("pending");
  });
});

describe("previewCounts + filterDocs", () => {
  const items = [item({ id: "i1", status: "submitted" })];
  const uploads = [
    file({ id: "a", request_item_id: "i1", ai_usability: verdict(true) }),
    file({ id: "b", request_item_id: "i1", ai_usability: verdict(false) }),
    file({ id: "c", request_item_id: "i1" }),
  ];
  const docs = buildPreviewDocs(uploads, items);

  it("counts by status", () => {
    expect(previewCounts(docs)).toEqual({
      all: 3,
      approved: 1,
      rejected: 1,
      pending: 1,
    });
  });

  it("filters by view", () => {
    expect(filterDocs(docs, "all")).toHaveLength(3);
    expect(filterDocs(docs, "approved").map((d) => d.fileId)).toEqual(["a"]);
    expect(filterDocs(docs, "rejected").map((d) => d.fileId)).toEqual(["b"]);
  });
});
