import { describe, it, expect } from "vitest";
import { archiveEntryPath, buildEngagementZipFiles } from "./download";

describe("archiveEntryPath", () => {
  it("places checklist files under an ASCII 'Checklist documents' folder", () => {
    expect(archiveEntryPath("checklist", "T4.pdf", false, "en")).toBe(
      "Checklist documents/T4.pdf",
    );
  });

  it("sets rejected checklist files apart under a Rejected subfolder", () => {
    expect(archiveEntryPath("checklist", "bad.pdf", true, "en")).toBe(
      "Checklist documents/Rejected/bad.pdf",
    );
  });

  it("only checklist files get the Rejected treatment", () => {
    // rejected has no meaning for signed/final, so it is ignored there.
    expect(archiveEntryPath("signed", "letter.pdf", true, "en")).toBe(
      "Signed documents/letter.pdf",
    );
    expect(archiveEntryPath("final", "return.pdf", true, "en")).toBe(
      "Final documents/return.pdf",
    );
  });

  it("uses localized but ASCII-transliterated folder names in French", () => {
    // "Documents signés" -> accents stripped for cross-platform unzip safety.
    expect(archiveEntryPath("signed", "x.pdf", false, "fr")).toBe(
      "Documents signes/x.pdf",
    );
    expect(archiveEntryPath("final", "x.pdf", false, "fr")).toBe(
      "Documents finaux/x.pdf",
    );
    expect(archiveEntryPath("checklist", "x.pdf", false, "fr")).toBe(
      "Documents de la liste/x.pdf",
    );
  });

  it("transliterates accented leaf filenames and preserves the extension", () => {
    const path = archiveEntryPath("checklist", "Relevé 2024.pdf", false, "en");
    expect(path.startsWith("Checklist documents/")).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
    // No non-ASCII survives into the entry name.
    expect(/[^\x20-\x7E]/.test(path)).toBe(false);
  });

  it("nests everything under the engagement folder when one is given", () => {
    expect(archiveEntryPath("final", "return.pdf", false, "en", "2025 T1")).toBe(
      "2025 T1/Final documents/return.pdf",
    );
    expect(archiveEntryPath("checklist", "bad.pdf", true, "en", "2025 T1")).toBe(
      "2025 T1/Checklist documents/Rejected/bad.pdf",
    );
  });
});

describe("buildEngagementZipFiles", () => {
  const base = {
    uploaded: [] as never[],
    signatures: [] as never[],
    finals: [] as never[],
    itemLabel: new Map<string, string>(),
    locale: "en" as const,
  };

  it("buckets all three categories to the right ZIP paths", () => {
    const { files } = buildEngagementZipFiles({
      ...base,
      uploaded: [
        {
          storage_path: "p/u.pdf",
          original_filename: "u.pdf",
          display_name: "T4.pdf",
          is_duplicate: false,
          review_status: "approved",
          size_bytes: 10,
        },
      ],
      signatures: [{ signed_file_path: "p/s.pdf", request_item_id: "ri1" }],
      finals: [
        {
          storage_path: "p/final/f.pdf",
          original_filename: "return.pdf",
          display_name: null,
          size_bytes: 20,
        },
      ],
      itemLabel: new Map([["ri1", "Engagement letter"]]),
    });
    expect(files.map((f) => f.path)).toEqual([
      "Checklist documents/T4.pdf",
      "Signed documents/Engagement letter.pdf",
      "Final documents/return.pdf",
    ]);
  });

  it("drops duplicate/pathless uploads, unsigned signatures, and invoice finals", () => {
    const { files } = buildEngagementZipFiles({
      ...base,
      uploaded: [
        {
          storage_path: null,
          original_filename: "x.pdf",
          display_name: null,
          is_duplicate: false,
          review_status: "approved",
          size_bytes: null,
        },
        {
          storage_path: "p/dup.pdf",
          original_filename: "dup.pdf",
          display_name: null,
          is_duplicate: true,
          review_status: "approved",
          size_bytes: null,
        },
      ],
      signatures: [{ signed_file_path: null, request_item_id: "ri1" }],
      finals: [
        {
          storage_path: "firms/f/engagements/e/invoices/inv.pdf",
          original_filename: "inv.pdf",
          display_name: null,
          size_bytes: 5,
        },
      ],
    });
    expect(files).toHaveLength(0);
  });

  it("estimates bytes: real upload/final sizes plus a nominal size per signed PDF", () => {
    const { bytes } = buildEngagementZipFiles({
      ...base,
      uploaded: [
        {
          storage_path: "p/u.pdf",
          original_filename: "u.pdf",
          display_name: null,
          is_duplicate: false,
          review_status: "approved",
          size_bytes: 100,
        },
      ],
      finals: [
        {
          storage_path: "p/final/f.pdf",
          original_filename: "f.pdf",
          display_name: null,
          size_bytes: 200,
        },
      ],
      signatures: [{ signed_file_path: "p/s.pdf", request_item_id: "ri1" }],
      itemLabel: new Map([["ri1", "Letter"]]),
    });
    // 100 + 200 + one signed PDF nominal (1 MiB).
    expect(bytes).toBe(100 + 200 + 1_048_576);
  });

  it("prefixes every entry with the engagement folder when given", () => {
    const { files } = buildEngagementZipFiles({
      ...base,
      engagementFolder: "2024 Year-End",
      uploaded: [
        {
          storage_path: "p/u.pdf",
          original_filename: "u.pdf",
          display_name: "Bank.pdf",
          is_duplicate: false,
          review_status: "rejected",
          size_bytes: null,
        },
      ],
    });
    expect(files[0].path).toBe("2024 Year-End/Checklist documents/Rejected/Bank.pdf");
  });
});
