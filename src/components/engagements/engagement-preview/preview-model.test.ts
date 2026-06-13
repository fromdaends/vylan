import { describe, it, expect } from "vitest";
import {
  resolvePreviewStatus,
  buildPreviewDocs,
  previewCounts,
  filterDocs,
  filterByItem,
  groupDocsByItem,
  groupDocsForGrid,
  flattenPreviewGroups,
  previewNavState,
  DUPLICATES_SECTION_ID,
  groupLabel,
  previewHeader,
  previewCardTitle,
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
    display_name: null,
    mime_type: "application/pdf",
    size_bytes: 100,
    ai_classification: null,
    ai_confidence: null,
    ai_extracted_fields: null,
    ai_usability: null,
    ai_rejected: false,
    review_status: "pending",
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    uploaded_at: "2026-01-01T00:00:00Z",
    content_hash: null,
    is_duplicate: false,
    duplicate_of_file_id: null,
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
    kind: "collection",
    signing_doc_path: null,
    signing_doc_name: null,
    signing_doc_mime: null,
    ai_set_assessment: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("resolvePreviewStatus", () => {
  it("the accountant's per-file approval wins over AI flags", () => {
    expect(
      resolvePreviewStatus(
        file({ review_status: "approved", ai_rejected: true }),
      ),
    ).toBe("approved");
  });
  it("the accountant's per-file rejection wins over an AI-usable verdict", () => {
    expect(
      resolvePreviewStatus(
        file({ review_status: "rejected", ai_usability: verdict(true) }),
      ),
    ).toBe("rejected");
  });
  it("a system auto-reject flag => rejected", () => {
    expect(resolvePreviewStatus(file({ ai_rejected: true }))).toBe("rejected");
  });
  it("an AI usable verdict (no concern) => approved suggestion", () => {
    expect(resolvePreviewStatus(file({ ai_usability: verdict(true) }))).toBe(
      "approved",
    );
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
      ),
    ).toBe("approved");
  });
  it("the accountant's approval still wins even over an AI type mismatch", () => {
    expect(
      resolvePreviewStatus(
        file({
          review_status: "approved",
          ai_usability: verdict(true),
          ai_extracted_fields: { looks_correct: false },
        }),
      ),
    ).toBe("approved");
  });
  it("an AI unusable verdict that was NOT sent to the client => flagged", () => {
    expect(resolvePreviewStatus(file({ ai_usability: verdict(false) }))).toBe(
      "flagged",
    );
  });
  it("an AI-unusable doc the system actually bounced to the client => rejected", () => {
    expect(
      resolvePreviewStatus(
        file({ ai_usability: verdict(false), ai_rejected: true }),
      ),
    ).toBe("rejected");
  });
  it("no verdict yet => pending (neutral)", () => {
    expect(resolvePreviewStatus(file({}))).toBe("pending");
  });
  it("a confident request mismatch => flagged, even on a usable scan", () => {
    expect(
      resolvePreviewStatus(file({ ai_usability: verdict(true) }), true),
    ).toBe("flagged");
  });
  it("the accountant's per-file approval still wins over a request mismatch", () => {
    expect(
      resolvePreviewStatus(
        file({ review_status: "approved", ai_usability: verdict(true) }),
        true,
      ),
    ).toBe("approved");
  });
  it("a request mismatch flags even before a usability verdict lands", () => {
    expect(resolvePreviewStatus(file({}), true)).toBe("flagged");
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
      file({ id: "c", request_item_id: "i2", review_status: "approved" }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    expect(docs).toHaveLength(3);

    const a = docs.find((d) => d.fileId === "a")!;
    expect(a.status).toBe("flagged");
    expect(a.siblingCount).toBe(2);

    const c = docs.find((d) => d.fileId === "c")!;
    expect(c.status).toBe("approved"); // this file was approved by the accountant
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

  it("carries the duplicate flags through to the doc", () => {
    const docs = buildPreviewDocs(
      [
        file({ id: "orig" }),
        file({
          id: "dup",
          is_duplicate: true,
          duplicate_of_file_id: "orig",
        }),
      ],
      [item({ id: "i1" })],
    );
    const orig = docs.find((d) => d.fileId === "orig")!;
    const dup = docs.find((d) => d.fileId === "dup")!;
    expect(orig.isDuplicate).toBe(false);
    expect(orig.duplicateOfFileId).toBeNull();
    expect(dup.isDuplicate).toBe(true);
    expect(dup.duplicateOfFileId).toBe("orig");
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

  it("the accountant's explicit per-file approval still wins over a request mismatch", () => {
    const docs = buildPreviewDocs(
      [{ ...glFile(), review_status: "approved" }],
      [glItem],
      { expectedYear: 2025, clientName: "Acme Corp" },
    );
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
    seq: 1,
    classification: null,
    extractedYear: null,
    itemLabel: "Trial Balance",
    itemLabelFr: "Balance de vérification",
    isImage: true,
    isPdf: false,
    searchText: "",
    isDuplicate: false,
    duplicateOfFileId: null,
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
      duplicates: 0,
    });
  });

  it("filters by view", () => {
    expect(filterDocs(docs, "all")).toHaveLength(3);
    expect(filterDocs(docs, "approved").map((d) => d.fileId)).toEqual(["a"]);
    expect(filterDocs(docs, "flagged").map((d) => d.fileId)).toEqual(["b"]);
    expect(filterDocs(docs, "rejected")).toHaveLength(0);
  });
});

describe("previewCounts + filterDocs — duplicates as their own bucket", () => {
  const items = [item({ id: "i1", status: "submitted" })];
  // 'a' is an approved original; 'b' is its exact re-upload, auto-rejected as a
  // duplicate (review_status rejected). 'b' must read as a DUPLICATE everywhere.
  const docs = buildPreviewDocs(
    [
      file({ id: "a", request_item_id: "i1", review_status: "approved" }),
      file({
        id: "b",
        request_item_id: "i1",
        review_status: "rejected",
        is_duplicate: true,
        duplicate_of_file_id: "a",
      }),
    ],
    items,
  );

  it("excludes a duplicate from `all`; counts it only under `duplicates`", () => {
    const c = previewCounts(docs);
    expect(c).toEqual({
      all: 1, // the real document only — the duplicate is NOT part of "All"
      approved: 1,
      flagged: 0,
      rejected: 0, // 'b' is rejected underneath, but it's a duplicate
      pending: 0,
      duplicates: 1,
    });
  });

  it("`all` is the non-duplicate total; all + duplicates === every file", () => {
    const c = previewCounts(docs);
    // The status buckets partition `all` (the real documents)...
    expect(c.approved + c.flagged + c.rejected + c.pending).toBe(c.all);
    // ...and duplicates sit alongside, so together they cover every upload.
    expect(c.all + c.duplicates).toBe(docs.length);
  });

  it("the duplicates view shows only the re-upload; ALL and the status views exclude it", () => {
    expect(filterDocs(docs, "duplicates").map((d) => d.fileId)).toEqual(["b"]);
    // 'b' is rejected underneath but a duplicate, so Rejected must not show it.
    expect(filterDocs(docs, "rejected")).toHaveLength(0);
    expect(filterDocs(docs, "approved").map((d) => d.fileId)).toEqual(["a"]);
    // ...and "All" now shows the real document only, not the duplicate.
    expect(filterDocs(docs, "all").map((d) => d.fileId)).toEqual(["a"]);
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

  it("flips only the overridden FILE, leaving its siblings untouched", () => {
    // a and b are siblings under item i1; overriding file "a" must not move "b".
    const out = applyOverrides(docs, new Map([["a", "approved"]]));
    expect(out.find((d) => d.fileId === "a")!.status).toBe("approved");
    expect(out.find((d) => d.fileId === "b")!.status).toBe("flagged");
    expect(out.find((d) => d.fileId === "c")!.status).toBe("flagged");
    expect(previewCounts(out)).toEqual({
      all: 3,
      approved: 1,
      flagged: 2,
      rejected: 0,
      pending: 0,
      duplicates: 0,
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

describe("groupDocsForGrid (Duplicates section)", () => {
  it("lifts a duplicate OUT of its item section into a trailing Duplicates section (the screenshot case)", () => {
    // Same file uploaded twice under one item: 'a' is the original, 'b' the
    // exact re-send. The duplicate must leave the item and live only under
    // Duplicates — one file, one place.
    const items = [item({ id: "i1", label: "T4 Slip" })];
    const uploads = [
      file({ id: "a", request_item_id: "i1", uploaded_at: "2026-01-01T00:00:00Z" }),
      file({
        id: "b",
        request_item_id: "i1",
        uploaded_at: "2026-01-02T00:00:00Z",
        is_duplicate: true,
        duplicate_of_file_id: "a",
      }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const groups = groupDocsForGrid(docs, items);
    expect(groups.map((g) => g.itemId)).toEqual(["i1", DUPLICATES_SECTION_ID]);
    // The item keeps ONLY the original; the duplicate is gone from it.
    expect(groups[0].docs.map((d) => d.fileId)).toEqual(["a"]);
    // ...and shows up exclusively in the Duplicates section.
    expect(groups[1].docs.map((d) => d.fileId)).toEqual(["b"]);
  });

  it("omits the Duplicates section entirely when nothing is a duplicate", () => {
    const items = [item({ id: "i1" })];
    const docs = buildPreviewDocs(
      [file({ id: "a", request_item_id: "i1" })],
      items,
    );
    const groups = groupDocsForGrid(docs, items);
    expect(groups.map((g) => g.itemId)).toEqual(["i1"]);
  });

  it("moves a duplicate even when its original is under a DIFFERENT item", () => {
    // Duplicates are detected engagement-wide, so the original can sit under
    // another checklist item. The dup still collapses into Duplicates, and the
    // item that held only the dup ('i2') disappears (it has no real docs).
    const items = [
      item({ id: "i1", label: "T4 Slip" }),
      item({ id: "i2", label: "RL-1" }),
    ];
    const uploads = [
      file({ id: "a", request_item_id: "i1", uploaded_at: "2026-01-01T00:00:00Z" }),
      file({
        id: "b",
        request_item_id: "i2",
        uploaded_at: "2026-01-02T00:00:00Z",
        is_duplicate: true,
        duplicate_of_file_id: "a",
      }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const groups = groupDocsForGrid(docs, items);
    expect(groups.map((g) => g.itemId)).toEqual(["i1", DUPLICATES_SECTION_ID]);
    expect(groups.find((g) => g.itemId === "i2")).toBeUndefined();
    expect(groups[1].docs.map((d) => d.fileId)).toEqual(["b"]);
  });

  it("puts signature sections before collection sections (signatures lead the grid)", () => {
    const items = [
      item({ id: "c1", label: "T4 Slip", kind: "collection", order_index: 0 }),
      item({
        id: "s1",
        label: "Engagement letter",
        kind: "signature",
        order_index: 1,
      }),
      item({ id: "c2", label: "RL-1", kind: "collection", order_index: 2 }),
    ];
    const docs = buildPreviewDocs(
      [
        file({ id: "a", request_item_id: "c1" }),
        file({ id: "b", request_item_id: "s1" }),
        file({ id: "c", request_item_id: "c2" }),
      ],
      items,
    );
    const groups = groupDocsForGrid(docs, items);
    // Signature item leads; the collection items keep their checklist order.
    expect(groups.map((g) => g.itemId)).toEqual(["s1", "c1", "c2"]);
  });

  it("orders the Duplicates section oldest-first, regardless of input order", () => {
    const items = [item({ id: "i1" })];
    const uploads = [
      file({ id: "orig", request_item_id: "i1", uploaded_at: "2026-01-01T00:00:00Z" }),
      file({
        id: "dupNew",
        request_item_id: "i1",
        uploaded_at: "2026-03-03T00:00:00Z",
        is_duplicate: true,
        duplicate_of_file_id: "orig",
      }),
      file({
        id: "dupOld",
        request_item_id: "i1",
        uploaded_at: "2026-02-02T00:00:00Z",
        is_duplicate: true,
        duplicate_of_file_id: "orig",
      }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const dupGroup = groupDocsForGrid(docs, items).find(
      (g) => g.itemId === DUPLICATES_SECTION_ID,
    )!;
    expect(dupGroup.docs.map((d) => d.fileId)).toEqual(["dupOld", "dupNew"]);
  });

  it("composes with a pre-filtered set (tabs/search already applied)", () => {
    // The overlay passes already-filtered docs. A set narrowed to just the
    // duplicate yields only the Duplicates section, no item sections.
    const items = [item({ id: "i1" })];
    const docs = buildPreviewDocs(
      [
        file({ id: "a", request_item_id: "i1" }),
        file({
          id: "b",
          request_item_id: "i1",
          is_duplicate: true,
          duplicate_of_file_id: "a",
        }),
      ],
      items,
    );
    const onlyDup = docs.filter((d) => d.isDuplicate);
    const groups = groupDocsForGrid(onlyDup, items);
    expect(groups.map((g) => g.itemId)).toEqual([DUPLICATES_SECTION_ID]);
    expect(groups[0].docs.map((d) => d.fileId)).toEqual(["b"]);
  });
});

describe("flattenPreviewGroups + previewNavState (detail prev/next)", () => {
  // A grid with a signature item leading, two collection items, and a
  // duplicate — so the flattened order exercises the full grid ordering.
  const items = [
    item({ id: "c1", label: "T4 Slip", kind: "collection", order_index: 0 }),
    item({
      id: "s1",
      label: "Engagement letter",
      kind: "signature",
      order_index: 1,
    }),
    item({ id: "c2", label: "RL-1", kind: "collection", order_index: 2 }),
  ];
  const uploads = [
    file({ id: "a", request_item_id: "c1", uploaded_at: "2026-01-01T00:00:00Z" }),
    file({ id: "b", request_item_id: "s1", uploaded_at: "2026-01-02T00:00:00Z" }),
    file({ id: "c", request_item_id: "c2", uploaded_at: "2026-01-03T00:00:00Z" }),
    file({
      id: "d",
      request_item_id: "c1",
      uploaded_at: "2026-01-04T00:00:00Z",
      is_duplicate: true,
      duplicate_of_file_id: "a",
    }),
  ];
  const groups = groupDocsForGrid(buildPreviewDocs(uploads, items), items);

  it("flattens groups into exact on-screen order (signature, collections, duplicates)", () => {
    expect(flattenPreviewGroups(groups).map((d) => d.fileId)).toEqual([
      "b", // signature item leads
      "a", // collection c1
      "c", // collection c2
      "d", // duplicates section trails
    ]);
  });

  it("locates the open doc and points the arrows at its neighbours", () => {
    const flat = flattenPreviewGroups(groups); // [b, a, c, d]
    expect(previewNavState(flat, "a")).toEqual({
      index: 1,
      total: 4,
      prevId: "b",
      nextId: "c",
    });
  });

  it("stops at the ends — no wrap (prev null at first, next null at last)", () => {
    const flat = flattenPreviewGroups(groups); // [b, a, c, d]
    expect(previewNavState(flat, "b")).toMatchObject({
      index: 0,
      prevId: null,
      nextId: "a",
    });
    expect(previewNavState(flat, "d")).toMatchObject({
      index: 3,
      prevId: "c",
      nextId: null,
    });
  });

  it("returns index -1 and no arrows when the open doc isn't in the set", () => {
    // e.g. it was just approved and dropped off a status-filtered tab.
    expect(previewNavState(flattenPreviewGroups(groups), "gone")).toEqual({
      index: -1,
      total: 4,
      prevId: null,
      nextId: null,
    });
  });

  it("handles a null selection (detail closed)", () => {
    expect(previewNavState(flattenPreviewGroups(groups), null)).toEqual({
      index: -1,
      total: 4,
      prevId: null,
      nextId: null,
    });
  });

  it("a single-doc grid has both arrows disabled", () => {
    const one = groupDocsForGrid(
      buildPreviewDocs([file({ id: "solo", request_item_id: "c1" })], items),
      items,
    );
    expect(previewNavState(flattenPreviewGroups(one), "solo")).toEqual({
      index: 0,
      total: 1,
      prevId: null,
      nextId: null,
    });
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

describe("buildPreviewDocs — sequence numbering + ordering", () => {
  it("numbers uploads per item oldest-first, regardless of input order", () => {
    const items = [item({ id: "i1" })];
    // Provided newest-first, as listUploadedFilesForEngagement returns them.
    const uploads = [
      file({ id: "c", request_item_id: "i1", uploaded_at: "2026-03-03T00:00:00Z" }),
      file({ id: "b", request_item_id: "i1", uploaded_at: "2026-02-02T00:00:00Z" }),
      file({ id: "a", request_item_id: "i1", uploaded_at: "2026-01-01T00:00:00Z" }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const seqOf = (id: string) => docs.find((d) => d.fileId === id)!.seq;
    expect(seqOf("a")).toBe(1); // oldest
    expect(seqOf("b")).toBe(2);
    expect(seqOf("c")).toBe(3); // newest
  });

  it("numbers each checklist item independently", () => {
    const items = [item({ id: "i1" }), item({ id: "i2" })];
    const uploads = [
      file({ id: "a", request_item_id: "i1", uploaded_at: "2026-01-01T00:00:00Z" }),
      file({ id: "b", request_item_id: "i2", uploaded_at: "2026-01-02T00:00:00Z" }),
      file({ id: "c", request_item_id: "i1", uploaded_at: "2026-01-03T00:00:00Z" }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const seqOf = (id: string) => docs.find((d) => d.fileId === id)!.seq;
    expect(seqOf("a")).toBe(1);
    expect(seqOf("c")).toBe(2); // second under i1
    expect(seqOf("b")).toBe(1); // first under i2
  });

  it("groups the present docs oldest-first by sequence", () => {
    const items = [item({ id: "i1" })];
    const uploads = [
      file({ id: "c", request_item_id: "i1", uploaded_at: "2026-03-03T00:00:00Z" }),
      file({ id: "a", request_item_id: "i1", uploaded_at: "2026-01-01T00:00:00Z" }),
      file({ id: "b", request_item_id: "i1", uploaded_at: "2026-02-02T00:00:00Z" }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const [group] = groupDocsByItem(docs, items);
    expect(group.docs.map((d) => d.fileId)).toEqual(["a", "b", "c"]);
  });

  it("keeps a number stable when a filter hides an earlier doc (non-contiguous is correct)", () => {
    const items = [item({ id: "i1" })];
    const uploads = [
      file({ id: "a", request_item_id: "i1", uploaded_at: "2026-01-01T00:00:00Z" }),
      file({ id: "b", request_item_id: "i1", uploaded_at: "2026-02-02T00:00:00Z" }),
    ];
    const docs = buildPreviewDocs(uploads, items);
    const filtered = docs.filter((d) => d.fileId === "b"); // a search hid "a"
    const [group] = groupDocsByItem(filtered, items);
    expect(group.docs[0].seq).toBe(2); // still "#2", never renumbered to "#1"
  });
});

describe("previewCardTitle", () => {
  function mk(over: Partial<PreviewDoc>): PreviewDoc {
    return {
      fileId: "f",
      itemId: "i",
      fileName: "scan.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1,
      uploadedAt: "2026-01-01T00:00:00Z",
      status: "pending",
      itemStatus: "submitted",
      siblingCount: 1,
      seq: 1,
      classification: null,
      extractedYear: null,
      itemLabel: "Trial Balance",
      itemLabelFr: "Balance de vérification",
      isImage: true,
      isPdf: false,
      searchText: "",
      isDuplicate: false,
      duplicateOfFileId: null,
      ...over,
    };
  }

  it("is the localized item name plus the sequence number", () => {
    expect(previewCardTitle(mk({ seq: 2 }), "en")).toBe("Trial Balance #2");
    expect(previewCardTitle(mk({ seq: 2 }), "fr")).toBe(
      "Balance de vérification #2",
    );
  });

  it("falls back to the doc-type header for an orphan with no item label", () => {
    expect(
      previewCardTitle(
        mk({
          itemLabel: "",
          itemLabelFr: null,
          classification: "t4",
          extractedYear: 2024,
          seq: 1,
        }),
        "en",
      ),
    ).toBe("T4 · 2024 #1");
  });

  it("falls back to the filename when there is neither label nor classification", () => {
    expect(
      previewCardTitle(
        mk({ itemLabel: "", itemLabelFr: null, fileName: "mystery.pdf", seq: 3 }),
        "en",
      ),
    ).toBe("mystery.pdf #3");
  });
});
