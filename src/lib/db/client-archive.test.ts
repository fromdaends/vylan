import { describe, it, expect } from "vitest";
import {
  buildClientArchive,
  type EngagementMetaRow,
  type UploadedRow,
  type SignatureRow,
  type FinalRow,
  type ItemRow,
} from "./client-archive";

const client = {
  id: "client-1",
  displayName: "Tremblay, Marie",
  type: "individual" as const,
};

function eng(partial: Partial<EngagementMetaRow> & { id: string }): EngagementMetaRow {
  return {
    id: partial.id,
    title: partial.title ?? "Untitled",
    type: partial.type ?? "t1",
    status: partial.status ?? "complete",
    archived_at: partial.archived_at ?? null,
    created_at: partial.created_at ?? "2025-01-01T00:00:00Z",
    due_date: partial.due_date ?? null,
  };
}

function upload(partial: Partial<UploadedRow> & { id: string; engagement_id: string }): UploadedRow {
  return {
    id: partial.id,
    engagement_id: partial.engagement_id,
    original_filename: partial.original_filename ?? "file.pdf",
    display_name: partial.display_name ?? null,
    is_duplicate: partial.is_duplicate ?? false,
    review_status: partial.review_status ?? "pending",
    uploaded_at: partial.uploaded_at ?? "2025-01-01T00:00:00Z",
    size_bytes: partial.size_bytes ?? null,
    // Honor an explicitly-passed null (the "missing object" case) instead of
    // coalescing it back to the default path.
    storage_path:
      "storage_path" in partial
        ? partial.storage_path!
        : "firms/f/engagements/e/items/i/x.pdf",
  };
}

const emptyInput = {
  client,
  engagements: [] as EngagementMetaRow[],
  uploaded: [] as UploadedRow[],
  signatures: [] as SignatureRow[],
  finals: [] as FinalRow[],
  items: [] as ItemRow[],
  locale: "en" as const,
};

describe("buildClientArchive", () => {
  it("returns an empty archive when the client has no engagements", () => {
    const out = buildClientArchive(emptyInput);
    expect(out.engagements).toHaveLength(0);
    expect(out.totalFiles).toBe(0);
    expect(out.client.displayName).toBe("Tremblay, Marie");
  });

  it("groups files under engagement then category, ordered checklist → signed → final", () => {
    const out = buildClientArchive({
      ...emptyInput,
      engagements: [eng({ id: "e1", title: "2025 T1" })],
      uploaded: [upload({ id: "u1", engagement_id: "e1", display_name: "T4.pdf" })],
      signatures: [
        {
          id: "s1",
          engagement_id: "e1",
          request_item_id: "ri1",
          signed_file_path: "firms/f/engagements/e1/signed/doc.pdf",
          completed_at: "2025-02-01T00:00:00Z",
          created_at: "2025-01-15T00:00:00Z",
        },
      ],
      finals: [
        {
          id: "d1",
          engagement_id: "e1",
          storage_path: "firms/f/engagements/e1/final/return.pdf",
          original_filename: "return.pdf",
          display_name: "Final return.pdf",
          size_bytes: 1000,
          created_at: "2025-03-01T00:00:00Z",
        },
      ],
      items: [{ id: "ri1", label: "Engagement letter", label_fr: "Lettre de mission" }],
    });

    expect(out.engagements).toHaveLength(1);
    const cats = out.engagements[0].categories;
    expect(cats.map((c) => c.key)).toEqual(["checklist", "signed", "final"]);
    expect(out.engagements[0].fileCount).toBe(3);
    expect(out.totalFiles).toBe(3);
    // Signed file is named from the checklist item label (EN locale).
    expect(cats[1].files[0].name).toBe("Engagement letter");
    // Checklist file uses display_name over original_filename.
    expect(cats[0].files[0].name).toBe("T4.pdf");
  });

  it("names signed documents from the FR item label when locale is fr", () => {
    const out = buildClientArchive({
      ...emptyInput,
      locale: "fr",
      engagements: [eng({ id: "e1" })],
      signatures: [
        {
          id: "s1",
          engagement_id: "e1",
          request_item_id: "ri1",
          signed_file_path: "firms/f/e/signed/x.pdf",
          completed_at: null,
          created_at: "2025-01-15T00:00:00Z",
        },
      ],
      items: [{ id: "ri1", label: "Engagement letter", label_fr: "Lettre de mission" }],
    });
    expect(out.engagements[0].categories[0].files[0].name).toBe("Lettre de mission");
  });

  it("drops duplicate uploads and uploads with no storage path", () => {
    const out = buildClientArchive({
      ...emptyInput,
      engagements: [eng({ id: "e1" })],
      uploaded: [
        upload({ id: "u1", engagement_id: "e1" }),
        upload({ id: "u2", engagement_id: "e1", is_duplicate: true }),
        upload({ id: "u3", engagement_id: "e1", storage_path: null }),
      ],
    });
    const checklist = out.engagements[0].categories[0];
    expect(checklist.files.map((f) => f.id)).toEqual(["u1"]);
    expect(out.totalFiles).toBe(1);
  });

  it("skips signatures that are not yet completed (no signed file path)", () => {
    const out = buildClientArchive({
      ...emptyInput,
      engagements: [eng({ id: "e1" })],
      signatures: [
        {
          id: "s1",
          engagement_id: "e1",
          request_item_id: "ri1",
          signed_file_path: null,
          completed_at: null,
          created_at: "2025-01-15T00:00:00Z",
        },
      ],
      items: [{ id: "ri1", label: "Letter", label_fr: null }],
    });
    // No downloadable signed file → no categories at all for this engagement.
    expect(out.engagements[0].categories).toHaveLength(0);
    expect(out.totalFiles).toBe(0);
  });

  it("excludes invoice attachments from the final documents category", () => {
    const out = buildClientArchive({
      ...emptyInput,
      engagements: [eng({ id: "e1" })],
      finals: [
        {
          id: "d1",
          engagement_id: "e1",
          storage_path: "firms/f/engagements/e1/final/return.pdf",
          original_filename: "return.pdf",
          display_name: null,
          size_bytes: null,
          created_at: "2025-03-01T00:00:00Z",
        },
        {
          id: "inv1",
          engagement_id: "e1",
          storage_path: "firms/f/engagements/e1/invoices/inv.pdf",
          original_filename: "inv.pdf",
          display_name: null,
          size_bytes: null,
          created_at: "2025-03-02T00:00:00Z",
        },
      ],
    });
    const finalCat = out.engagements[0].categories.find((c) => c.key === "final");
    expect(finalCat?.files.map((f) => f.id)).toEqual(["d1"]);
  });

  it("flags rejected checklist files and passes through the review status", () => {
    const out = buildClientArchive({
      ...emptyInput,
      engagements: [eng({ id: "e1" })],
      uploaded: [
        upload({ id: "u1", engagement_id: "e1", review_status: "rejected" }),
        upload({ id: "u2", engagement_id: "e1", review_status: "approved" }),
      ],
    });
    const files = out.engagements[0].categories[0].files;
    const rejected = files.find((f) => f.id === "u1")!;
    const approved = files.find((f) => f.id === "u2")!;
    expect(rejected.rejected).toBe(true);
    expect(rejected.status).toBe("rejected");
    expect(approved.rejected).toBe(false);
    expect(approved.status).toBe("approved");
  });

  it("orders files newest-first within a category", () => {
    const out = buildClientArchive({
      ...emptyInput,
      engagements: [eng({ id: "e1" })],
      uploaded: [
        upload({ id: "old", engagement_id: "e1", uploaded_at: "2025-01-01T00:00:00Z" }),
        upload({ id: "new", engagement_id: "e1", uploaded_at: "2025-06-01T00:00:00Z" }),
        upload({ id: "mid", engagement_id: "e1", uploaded_at: "2025-03-01T00:00:00Z" }),
      ],
    });
    expect(out.engagements[0].categories[0].files.map((f) => f.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("preserves the engagement order it is given and marks archived engagements", () => {
    const out = buildClientArchive({
      ...emptyInput,
      engagements: [
        eng({ id: "e2", title: "2025", created_at: "2025-01-01T00:00:00Z" }),
        eng({ id: "e1", title: "2024", created_at: "2024-01-01T00:00:00Z", archived_at: "2025-05-01T00:00:00Z" }),
      ],
      uploaded: [
        upload({ id: "u1", engagement_id: "e1" }),
        upload({ id: "u2", engagement_id: "e2" }),
      ],
    });
    expect(out.engagements.map((e) => e.id)).toEqual(["e2", "e1"]);
    expect(out.engagements[0].archived).toBe(false);
    expect(out.engagements[1].archived).toBe(true);
  });

  it("omits engagements' empty categories (only non-empty groups appear)", () => {
    const out = buildClientArchive({
      ...emptyInput,
      engagements: [eng({ id: "e1" })],
      uploaded: [upload({ id: "u1", engagement_id: "e1" })],
    });
    // Only checklist has files; signed and final are omitted entirely.
    expect(out.engagements[0].categories.map((c) => c.key)).toEqual(["checklist"]);
  });
});
