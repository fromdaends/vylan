import { describe, it, expect } from "vitest";
import {
  resolvePreviewStatus,
  buildPreviewDocs,
  previewCounts,
  filterDocs,
  previewHeader,
  applyOverrides,
  searchDocs,
  normalizeText,
  type PreviewDoc,
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

  it("carries classification, year, and mime flags onto the doc", () => {
    const docs = buildPreviewDocs(
      [
        file({
          id: "a",
          mime_type: "image/png",
          ai_classification: "t4",
          ai_extracted_fields: { extracted_year: 2024 },
        }),
      ],
      [item({ id: "i1" })],
    );
    expect(docs[0].classification).toBe("t4");
    expect(docs[0].extractedYear).toBe(2024);
    expect(docs[0].isImage).toBe(true);
    expect(docs[0].isPdf).toBe(false);
  });

  it("defaults a file whose item is missing to pending", () => {
    const docs = buildPreviewDocs([file({ request_item_id: "ghost" })], []);
    expect(docs[0].status).toBe("pending");
    expect(docs[0].itemStatus).toBe("pending");
  });
});

describe("previewHeader", () => {
  const base: PreviewDoc = {
    fileId: "f",
    itemId: "i",
    fileName: "scan.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1,
    uploadedAt: "2026-01-01T00:00:00Z",
    status: "pending",
    itemStatus: "submitted",
    siblingCount: 1,
    classification: null,
    extractedYear: null,
    itemLabel: "Trial Balance",
    itemLabelFr: "Balance de vérification",
    isImage: true,
    isPdf: false,
    searchText: "",
  };

  it("uses the short doc-type name + year when classified", () => {
    expect(
      previewHeader({ ...base, classification: "t4", extractedYear: 2024 }, "en"),
    ).toBe("T4 · 2024");
  });
  it("drops the year when not extracted", () => {
    expect(
      previewHeader({ ...base, classification: "bank_statement" }, "en"),
    ).toBe("Bank statements");
  });
  it("falls back to the localized item label when unclassified", () => {
    expect(previewHeader(base, "en")).toBe("Trial Balance");
    expect(previewHeader(base, "fr")).toBe("Balance de vérification");
  });
  it("falls back to the filename when there is no item label", () => {
    expect(previewHeader({ ...base, itemLabel: "", itemLabelFr: null }, "en")).toBe(
      "scan.jpg",
    );
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

describe("applyOverrides", () => {
  const items = [
    item({ id: "i1", status: "submitted" }),
    item({ id: "i2", status: "submitted" }),
  ];
  const uploads = [
    file({ id: "a", request_item_id: "i1", ai_usability: verdict(false) }),
    file({ id: "b", request_item_id: "i1", ai_usability: verdict(false) }),
    file({ id: "c", request_item_id: "i2", ai_usability: verdict(false) }),
  ];
  const docs = buildPreviewDocs(uploads, items);

  it("returns the same array when there are no overrides", () => {
    expect(applyOverrides(docs, new Map())).toBe(docs);
  });

  it("flips every sibling under an overridden item, leaving others untouched", () => {
    const out = applyOverrides(docs, new Map([["i1", "approved"]]));
    expect(out.find((d) => d.fileId === "a")!.status).toBe("approved");
    expect(out.find((d) => d.fileId === "b")!.status).toBe("approved");
    expect(out.find((d) => d.fileId === "c")!.status).toBe("rejected");
    expect(previewCounts(out)).toEqual({
      all: 3,
      approved: 2,
      rejected: 1,
      pending: 0,
    });
  });
});

describe("normalizeText", () => {
  it("strips accents and lower-cases", () => {
    expect(normalizeText("Rémunération ÉTÉ")).toBe("remuneration ete");
  });
});

describe("searchDocs", () => {
  const items = [item({ id: "i1", status: "submitted" })];
  const uploads = [
    file({
      id: "a",
      request_item_id: "i1",
      original_filename: "scan.png",
      ai_classification: "t4",
      ai_extracted_fields: {
        extracted_year: 2024,
        issuer_name: "Acme Payroll",
        party_name: "Geneviève Côté",
      },
    }),
    file({
      id: "b",
      request_item_id: "i1",
      original_filename: "rbc-statement.pdf",
      ai_classification: "bank_statement",
      ai_extracted_fields: { extracted_year: 2023 },
    }),
  ];
  const docs = buildPreviewDocs(uploads, items);
  const ids = (q: string) => searchDocs(docs, q).map((d) => d.fileId);

  it("an empty query returns everything", () => {
    expect(searchDocs(docs, "   ")).toHaveLength(2);
  });
  it("matches the doc-type name even when it differs from the code", () => {
    expect(ids("remuneration")).toEqual(["a"]); // T4's official EN title
  });
  it("matches by year", () => {
    expect(ids("2023")).toEqual(["b"]);
  });
  it("matches issuer + is accent-insensitive on the taxpayer name", () => {
    expect(ids("acme")).toEqual(["a"]);
    expect(ids("genevieve")).toEqual(["a"]);
  });
  it("matches by filename", () => {
    expect(ids("rbc")).toEqual(["b"]);
  });
  it("AND-combines every token", () => {
    expect(ids("bank 2023")).toEqual(["b"]);
    expect(searchDocs(docs, "bank 2024")).toHaveLength(0);
  });
});
