import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  pdfPageCount,
  describeFilePages,
  isBulkUpload,
  BULK_PDF_PAGE_THRESHOLD,
} from "./pdf-pages";

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([600, 800]);
  return Buffer.from(await doc.save());
}

describe("pdfPageCount", () => {
  it("counts exactly, at the sizes bookkeeping actually sees", async () => {
    // 3 = the founder's failing case; 30 = a year of statements in one PDF;
    // 200 = a general ledger export. Counting must not degrade with length.
    for (const n of [1, 3, 12, 30, 200]) {
      expect(await pdfPageCount(await makePdf(n))).toBe(n);
    }
  });

  it("returns null instead of throwing on a non-PDF or corrupt file", async () => {
    expect(await pdfPageCount(Buffer.from("not a pdf at all"))).toBeNull();
    expect(await pdfPageCount(Buffer.alloc(0))).toBeNull();
    // Truncated PDF header — the shape a half-failed upload takes.
    expect(await pdfPageCount(Buffer.from("%PDF-1.7\n%%EOF"))).toBeNull();
  });
});

describe("describeFilePages", () => {
  it("states each file's real length and the total", () => {
    const out = describeFilePages([
      { isPdf: true, pageCount: 3 },
      { isPdf: false, pageCount: null },
    ]);
    expect(out).toContain("File 1: a PDF containing exactly 3 pages.");
    expect(out).toContain("File 2: a single image (1 page).");
    expect(out).toContain("Total pages across all files: 4.");
    // The instruction that turns the counts into a missing-page check.
    expect(out).toContain("PRINTED on the pages");
  });

  it("uses the singular for a one-page PDF", () => {
    expect(describeFilePages([{ isPdf: true, pageCount: 1 }])).toContain(
      "exactly 1 page.",
    );
  });

  it("admits when a page count could not be read rather than inventing one", () => {
    const out = describeFilePages([{ isPdf: true, pageCount: null }]);
    expect(out).toContain("could not be read");
  });

  it("returns nothing for no files", () => {
    expect(describeFilePages([])).toBe("");
  });
});

describe("isBulkUpload", () => {
  it("treats a year of statements as bulk and a single statement as not", () => {
    expect(isBulkUpload(4)).toBe(false);
    expect(isBulkUpload(BULK_PDF_PAGE_THRESHOLD - 1)).toBe(false);
    expect(isBulkUpload(BULK_PDF_PAGE_THRESHOLD)).toBe(true);
    expect(isBulkUpload(200)).toBe(true);
  });
});
