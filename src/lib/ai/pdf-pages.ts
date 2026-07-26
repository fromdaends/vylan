// Exact PDF page counting, done in CODE rather than by asking the model.
//
// WHY: the set review used to infer a document's length from what it could see,
// which is how a 3-page PDF whose own footers read "Page 2 of 4" was called "a
// complete 4-page statement". Counting is arithmetic, not judgement — reading
// the page tree is exact, free, and just as reliable at 300 pages as at 3.
// The model is then told the real number instead of having to work it out, so
// its only job is the part that genuinely needs judgement: what the printed
// page markers SAY the document should contain.

import { PDFDocument } from "pdf-lib";

// Above this, a single upload is a bulk drop (a year of statements, a general
// ledger export) rather than one document. Not a rejection — a signal that the
// set review should describe coverage rather than try to police page order.
export const BULK_PDF_PAGE_THRESHOLD = 25;

// Page count of a PDF, or null when it cannot be read.
//
// Fail-soft on purpose: a malformed or encrypted PDF must degrade to "unknown
// length" (the previous behaviour) and never break an upload. ignoreEncryption
// lets us count pages of a password-protected-for-editing file, which banks
// routinely produce and which still renders fine.
export async function pdfPageCount(bytes: Buffer): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const n = doc.getPageCount();
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// One line per file telling the model exactly what it was handed, so it never
// has to guess how long a document is. Pure + exported for tests.
//
// The counts are FACTS the model must not contradict: its job is to compare
// them against the page markers PRINTED on the pages ("Page 2 of 4") and report
// the gap. Stated plainly because a model told "this file has 3 pages" and
// shown a footer saying "of 4" reliably reports the missing page, while a model
// left to count for itself reliably does not.
export function describeFilePages(
  files: { pageCount: number | null; isPdf: boolean }[],
): string {
  if (files.length === 0) return "";
  const lines = files.map((f, i) => {
    const n = i + 1;
    if (!f.isPdf) return `File ${n}: a single image (1 page).`;
    if (f.pageCount == null) {
      return `File ${n}: a PDF whose page count could not be read — judge its length from the pages themselves.`;
    }
    return `File ${n}: a PDF containing exactly ${f.pageCount} page${
      f.pageCount === 1 ? "" : "s"
    }.`;
  });
  const total = files.reduce(
    (sum, f) => sum + (f.isPdf ? (f.pageCount ?? 0) : 1),
    0,
  );
  return [
    "PAGE COUNTS (these are measured facts about the files you were given — never contradict them):",
    ...lines,
    `Total pages across all files: ${total}.`,
    "Compare these counts against the page markers PRINTED on the pages themselves. If a document's own footer says it has more pages than the file actually contains, the missing ones are exactly the gap — name them.",
  ].join("\n");
}

// Whether this upload should be treated as a bulk drop rather than one tidy
// document — a year of statements, a ledger export, a batch of receipts.
export function isBulkUpload(totalPages: number): boolean {
  return totalPages >= BULK_PDF_PAGE_THRESHOLD;
}
