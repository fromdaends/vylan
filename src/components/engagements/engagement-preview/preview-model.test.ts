import { describe, it, expect } from "vitest";
import {
  resolvePreviewStatus,
  buildPreviewDocs,
  previewCounts,
  filterDocs,
  filterByItem,
  groupDocsByItem,
  groupLabel,
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
  it("an AI usable verdict (no concern) => approved", () => {
    expect(
      resolvePreviewStatus(file({ ai_usability: verdict(true) }), "submitted"),
    ).toBe("approved");
  });
  it("a usable doc the AI reads as the WRONG type (looks_correct=false) => flagged, not approved", () => {
    expect(
      resolvePreviewStatus(
        file({
          ai_usability: verdict(true),
          ai_extracted_fields: {
            looks_correct: false,
            issue_if_any: "Looks like a T4, not a general ledger export.",
          },
        }),
        "submitted",
      ),
    ).toBe("flagged");
  });
  it("a usable doc with looks_correct=true stays approved", () => {
    expect(
      resolvePreviewStatus(
        file({
          ai_usability: verdict(true),
          ai_extracted_fields: { looks_correct: true },
        }),
        "submitted",
      ),
    ).toBe("approved");
  });
  it("the accountant's approval still wins even over an AI type mismatch", () => {
    expect(
      resolvePreviewStatus(
        file({
          ai_usability: verdict(true),
          ai_extracted_fields: { looks_correct: false },
        }),
        "approved",
      ),
    ).toBe("approved");
  });
  it("an AI unusable verdict that was NOT sent to the client => flagged", () => {
    expect(
      resolvePreviewStatus(file({ ai_usability: verdict(false) }), "submitted"),
    ).toBe("flagged");
  });
  it("an AI-unusable doc the system actually bounced to the client => rejected", () => {
    expect(
      resolvePreviewStatus(
        file({ ai_usability: verdict(false), ai_rejected: true }),
        "submitted",
      ),
    ).toBe("rejected");
  });
  it("no verdict yet => pending (neutral)", () => {
    expect(resolvePreviewStatus(file({}), "pending")).toBe("pending");
  });
  it("a confident request mismatch => flagged, even on a usable scan", () => {
    expect(
      resolvePreviewStatus(
        file({ ai_usability: verdict(true) }),
        "submitted",
        true,
      ),
    ).toBe("flagged");
  });
  it("the accountant's approval still wins over a request mismatch", () => {
    expect(
      resolvePreviewStatus(
        file({ ai_usability: verdict(true) }),
        "approved",
        true,
      ),
    ).toBe("approved");
  });
  it("a request mismatch flags even before a usability verdict lands", () => {
    expect(resolvePreviewStatus(file({}), "submitted", true)).toBe("flagged");
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
    expect(a.status).toBe("flagged");
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

describe("buildPreviewDocs — request matching (flag docs that don't match)", () => {
  // A General Ledger export that READS fine on its own but doesn't match the
  // engagement: from the founder's report (status was wrongly "Looks good").
  const glItem = item({ id: "i1", doc_type: "gl_export", status: "submitted" });
  function glFile(): UploadedFile {
    return file({
      id: "a",
      request_item_id: "i1",
      ai_classification: "gl_export",
      ai_confidence: 0.95,
      ai_usability: verdict(true),
      ai_extracted_fields: {
        extracted_year: 2024,
        party_name: "G-Accon LLC",
        fields_confidence: 0.9,
      },
    });
  }

  it("flags a usable doc whose YEAR doesn't match the expected tax year", () => {
    // Same name (isolates the year mismatch): expected 2025, reads 2024.
    const docs = buildPreviewDocs([glFile()], [glItem], {
      expectedYear: 2025,
      clientName: "G-Accon LLC",
    });
    expect(docs[0].status).toBe("flagged");
  });

  it("flags a usable doc whose CLIENT NAME is a stranger to the engagement", () => {
    // Same year (isolates the identity mismatch): client Acme vs doc G-Accon.
    const docs = buildPreviewDocs([glFile()], [glItem], {
      expectedYear: 2024,
      clientName: "Acme Corp",
    });
    expect(docs[0].status).toBe("flagged");
  });

  it("keeps a usable doc that matches type + year + client as approved", () => {
    const docs = buildPreviewDocs([glFile()], [glItem], {
      expectedYear: 2024,
      clientName: "G-Accon LLC",
    });
    expect(docs[0].status).toBe("approved");
  });

  it("the accountant's explicit approval still wins over a request mismatch", () => {
    const approved = item({
      id: "i1",
      doc_type: "gl_export",
      status: "approved",
    });
    const docs = buildPreviewDocs([glFile()], [approved], {
      expectedYear: 2025,
      clientName: "Acme Corp",
    });
    expect(docs[0].status).toBe("approved");
  });

  it("does NOT flag a recognised doc under a freeform 'other' item on type alone", () => {
    const otherItem = item({ id: "i1", doc_type: "other", status: "submitted" });
    const docs = buildPreviewDocs(
      [
        file({
          id: "a",
          request_item_id: "i1",
          ai_classification: "bank_statement",
          ai_confidence: 0.95,
          ai_usability: verdict(true),
          ai_extracted_fields: { fields_confidence: 0.9 },
        }),
      ],
      [otherItem],
      { expectedYear: null, clientName: null },
    );
    expect(docs[0].status).toBe("approved");
  });

  it("without engagement context (no opts) a usable, type-matching doc stays approved", () => {
    // The old 2-arg call (existing callers/tests) must not start flagging.
    const docs = buildPreviewDocs([glFile()], [glItem]);
    expect(docs[0].status).toBe("approved");
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
      flagged: 1,
      rejected: 0,
      pending: 1,
    });
  });

  it("filters by view", () => {
    expect(filterDocs(docs, "all")).toHaveLength(3);
    expect(filterDocs(docs, "approved").map((d) => d.fileId)).toEqual(["a"]);
    expect(filterDocs(docs, "flagged").map((d) => d.fileId)).toEqual(["b"]);
    expect(filterDocs(docs, "rejected")).toHaveLength(0);
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
    expect(out.find((d) => d.fileId === "c")!.status).toBe("flagged");
    expect(previewCounts(out)).toEqual({
      all: 3,
      approved: 2,
      flagged: 1,
      rejected: 0,
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

describe("groupDocsByItem", () => {
  it("groups docs by item in checklist order, skipping items with no docs", () => {
    // items arrive pre-ordered by order_index (as listRequestItems returns
    // them); the middle item has no uploads and must be skipped.
    const items = [
      item({ id: "i1", label: "Trial balance" }),
      item({ id: "i2", label: "T4" }),
      item({ id: "i3", label: "Bank statement" }),
    ];
    const uploads = [
      file({ id: "a", request_item_id: "i3" }),
      file({ id: "b", request_item_id: "i1" }),
      file({ id: "c", request_item_id: "i1" }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const groups = groupDocsByItem(docs, items);
    expect(groups.map((g) => g.itemId)).toEqual(["i1", "i3"]); // i2 skipped, order kept
    expect(groups[0].docs.map((d) => d.fileId)).toEqual(["b", "c"]);
    expect(groups[1].docs.map((d) => d.fileId)).toEqual(["a"]);
  });

  it("puts orphan files (item deleted) in a trailing section", () => {
    const items = [item({ id: "i1", label: "Trial balance" })];
    const uploads = [
      file({ id: "a", request_item_id: "i1" }),
      file({ id: "z", request_item_id: "ghost" }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const groups = groupDocsByItem(docs, items);
    expect(groups.map((g) => g.itemId)).toEqual(["i1", "ghost"]);
    expect(groups[1].docs.map((d) => d.fileId)).toEqual(["z"]);
  });
});

describe("groupLabel", () => {
  it("uses the FR label under fr locale, EN otherwise", () => {
    const items = [
      item({ id: "i1", label: "Trial balance", label_fr: "Balance de vérification" }),
    ];
    const docs = buildPreviewDocs([file({ id: "a", request_item_id: "i1" })], items);
    const [g] = groupDocsByItem(docs, items);
    expect(groupLabel(g, "en")).toBe("Trial balance");
    expect(groupLabel(g, "fr")).toBe("Balance de vérification");
  });

  it("falls back to the filename for an orphan section with no label", () => {
    const docs = buildPreviewDocs(
      [file({ id: "z", request_item_id: "ghost", original_filename: "mystery.pdf" })],
      [],
    );
    const [g] = groupDocsByItem(docs, []);
    expect(groupLabel(g, "en")).toBe("mystery.pdf");
  });
});

describe("filterByItem", () => {
  const items = [item({ id: "i1" }), item({ id: "i2" })];
  const docs = buildPreviewDocs(
    [
      file({ id: "a", request_item_id: "i1" }),
      file({ id: "b", request_item_id: "i1" }),
      file({ id: "c", request_item_id: "i2" }),
    ],
    items,
  );

  it("'all' returns everything unchanged", () => {
    expect(filterByItem(docs, "all")).toBe(docs);
  });

  it("filters to a single checklist item", () => {
    expect(filterByItem(docs, "i1").map((d) => d.fileId)).toEqual(["a", "b"]);
    expect(filterByItem(docs, "i2").map((d) => d.fileId)).toEqual(["c"]);
  });

  it("composes with searchDocs + filterDocs (item + search + status)", () => {
    // The overlay applies: search -> item -> status. Mirror that here.
    const searched = searchDocs(docs, ""); // empty search keeps all
    const scoped = filterByItem(searched, "i1");
    expect(previewCounts(scoped).all).toBe(2);
    expect(filterDocs(scoped, "all").map((d) => d.fileId)).toEqual(["a", "b"]);
  });
});
