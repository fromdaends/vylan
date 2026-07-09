// Read a document's text/data in code, so the AI can still VERIFY it against the
// checklist without the vision model having to "look at" it.
//
// The vision model (Claude / GPT-5) reads PDFs and images natively, so those go
// to it directly. But it CANNOT open an Excel workbook or a CSV. This module
// pulls the text/data out of those machine-readable files (and, when useful, out
// of a text-layer PDF) so the classifier can read that text and judge "is this
// the document the checklist asked for?" — the same verification every other
// upload gets, just fed as text instead of an image.
//
// extractReadable() returns null for anything code cannot turn into meaningful
// text (an image, a scanned/image-only PDF) — those go to the vision model.

import { unzipSync, strFromU8 } from "fflate";
import { parseCsv } from "@/lib/csv";

export type ReadableKind = "pdf_text" | "xlsx" | "xls" | "csv";

export type ReadableExtraction = {
  kind: ReadableKind;
  // The extracted text/data, capped for use as the classifier's input (in place
  // of an image). "" when nothing meaningful could be read (e.g. legacy .xls).
  text: string;
  // Count of extractable alphanumeric characters — this is what the PDF
  // text-layer test is gated on (a scanned/image-only PDF yields ~0 here).
  char_count: number;
  // A short slice of the content, for showing the accountant what code read.
  text_preview: string;
  // Best-effort 4-digit tax year read off the text (null when none is present).
  extracted_year: number | null;
  // Spreadsheet / CSV shape. Null for PDFs.
  sheet_names: string[] | null;
  row_count: number | null;
  column_headers: string[] | null;
};

// A short slice of the content, for accountant-facing display.
const PREVIEW_CHARS = 2000;
// How much extracted text we hand the classifier (≈ a few thousand tokens). A
// document's identifying content (form title, names, totals) is near the top,
// so a generous cap is plenty and bounds the prompt cost.
const MAX_CLASSIFY_TEXT = 50_000;

// Hardening for the .xlsx parser, which runs on UNTRUSTED client uploads:
//  * refuse any zip entry whose declared uncompressed size is huge (zip-bomb
//    guard) and only decompress the few parts we actually read,
//  * skip regex-scanning a part larger than a sane ceiling,
//  * bound how many cells we pull out of one workbook.
// All the XML regexes below also bound their `[^>]` / content runs (e.g.
// `[^>]{0,512}`) so a crafted part with no closing `>` can't cause quadratic
// backtracking that stalls the event loop.
const MAX_XLSX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_XML_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_SHEET_CELLS = 50_000;
const MAX_ATTR = 512; // longest `[^>]*` run we allow inside a tag
const MAX_CELL = 32_768; // Excel's own single-cell character ceiling

// A real text layer yields hundreds+ of characters; a scanned or photographed
// (image-only) PDF yields ~0 because pdf.js finds no text-drawing operators. We
// require BOTH an absolute floor AND a per-page average so a scanned PDF that
// happens to carry a tiny text watermark or footer can't masquerade as a text
// layer — those correctly stay on the vision path.
const MIN_PDF_TEXT_CHARS_TOTAL = 100;
const MIN_PDF_TEXT_CHARS_PER_PAGE = 40;

// The bare media type — strip a "; charset=…" suffix and lowercase. MIME can
// arrive from a browser or a storage CDN header with parameters attached.
function normalizeMime(mime: string): string {
  return (mime || "").split(";")[0]!.trim().toLowerCase();
}

function extname(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

// Detect whether code can read this upload directly and, if so, extract its
// fields. Returns null when the file needs the vision model (images, and
// scanned / image-only PDFs). Never throws — any parser error resolves to null
// so the caller falls back to the AI path.
export async function extractReadable(
  bytes: Buffer,
  mimeType: string,
  filename: string,
): Promise<ReadableExtraction | null> {
  try {
    const mt = normalizeMime(mimeType);
    const ext = extname(filename);

    // CSV — plain text, always code-readable.
    if (mt === "text/csv" || mt === "application/csv" || ext === ".csv") {
      return extractCsv(bytes);
    }

    // Excel — decide by the actual container bytes, not the (often wrong)
    // MIME/extension: a .xlsx is a ZIP (PK\x03\x04); a legacy .xls is an OLE
    // compound file (D0 CF 11 E0). Browsers and clients routinely mislabel one
    // as the other, so sniff the magic before parsing.
    const isExcelMime =
      mt ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mt === "application/vnd.ms-excel";
    if (isExcelMime || ext === ".xlsx" || ext === ".xls") {
      if (isZip(bytes)) return extractXlsx(bytes);
      if (isOle(bytes)) return extractLegacyXls();
      // Claims to be Excel but is neither container — let the AI path decide
      // (it will flag it unsupported, which is the honest outcome).
      return null;
    }

    // PDF — code-readable ONLY when it has a real text layer.
    if (mt === "application/pdf" || ext === ".pdf") {
      return await extractPdfText(bytes);
    }

    // Images and everything else: not code-readable — send to the vision model.
    return null;
  } catch (e) {
    console.warn("[readable] extraction failed, deferring to AI path:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function extractCsv(bytes: Buffer): ReadableExtraction {
  const text = decodeUtf8(bytes);
  const rows = parseCsv(text);
  const headers = rows.length > 0 ? rows[0]! : [];
  return {
    kind: "csv",
    text: text.slice(0, MAX_CLASSIFY_TEXT),
    char_count: text.trim().length,
    text_preview: text.slice(0, PREVIEW_CHARS),
    extracted_year: findYear(text),
    sheet_names: null,
    // First row is the header, so the data-row count excludes it.
    row_count: Math.max(0, rows.length - (headers.length > 0 ? 1 : 0)),
    column_headers: headers,
  };
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) — a ZIP of XML parts. We only need fflate (already a dep) to
// unzip, then a light XML read of the shared-string table + each worksheet.
// This intentionally does NOT reconstruct sparse column layout or types — it
// pulls the cell TEXT for a preview + header/row extraction, which is all the
// fast path needs.
// ---------------------------------------------------------------------------

function extractXlsx(bytes: Buffer): ReadableExtraction | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes), {
      // Only decompress the parts we read, and refuse any entry whose declared
      // uncompressed size is oversized — a zip-bomb guard so a crafted .xlsx
      // can't inflate to gigabytes and OOM the worker.
      filter: (f) =>
        f.originalSize <= MAX_XLSX_ENTRY_BYTES &&
        (f.name === "xl/sharedStrings.xml" ||
          f.name === "xl/workbook.xml" ||
          /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name)),
    });
  } catch {
    return null; // corrupt/invalid zip → defer to the AI path
  }

  // Shared strings: most text cells store an index into this table. An <si>
  // item may hold several <t> runs (rich text) — concatenate them. A self-closing
  // <si/> (an empty item) still occupies an index, so it must push "" or every
  // later index shifts.
  const shared: string[] = [];
  const ss = xmlPart(files["xl/sharedStrings.xml"]);
  if (ss) {
    for (const si of ss.matchAll(
      /<si\b[^>]{0,512}\/>|<si\b[^>]{0,512}>([\s\S]{0,2000000}?)<\/si>/g,
    )) {
      const inner = si[1];
      if (inner == null) {
        shared.push(""); // self-closing <si/>
        continue;
      }
      const runs = [...inner.matchAll(/<t\b[^>]{0,512}>([\s\S]{0,32768}?)<\/t>/g)].map(
        (m) => decodeXmlEntities(m[1]!),
      );
      shared.push(runs.join(""));
    }
  }

  // Sheet names (display order) off the workbook part.
  const sheetNames: string[] = [];
  const wb = xmlPart(files["xl/workbook.xml"]);
  if (wb) {
    for (const m of wb.matchAll(/<sheet\b[^>]{0,512}\bname="([^"]{0,512})"/g)) {
      sheetNames.push(decodeXmlEntities(m[1]!));
    }
  }

  const sheetPaths = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => sheetNum(a) - sheetNum(b));

  const textParts: string[] = [];
  let firstSheetRows: string[][] = [];
  let cellBudget = MAX_SHEET_CELLS;
  for (const path of sheetPaths) {
    const xml = xmlPart(files[path]);
    if (!xml) continue;
    const rows = parseSheetXml(xml, shared, cellBudget);
    cellBudget -= rows.reduce((n, r) => n + r.length, 0);
    if (path === sheetPaths[0]) firstSheetRows = rows;
    for (const row of rows) textParts.push(row.join("\t"));
    if (cellBudget <= 0) break;
  }

  const text = textParts.join("\n");
  const headers = firstSheetRows.length > 0 ? firstSheetRows[0]! : [];
  return {
    kind: "xlsx",
    text: text.slice(0, MAX_CLASSIFY_TEXT),
    char_count: text.trim().length,
    text_preview: text.slice(0, PREVIEW_CHARS),
    extracted_year: findYear(text),
    sheet_names:
      sheetNames.length > 0
        ? sheetNames
        : sheetPaths.map((_, i) => `Sheet${i + 1}`),
    row_count: Math.max(0, firstSheetRows.length - (headers.length > 0 ? 1 : 0)),
    column_headers: headers,
  };
}

function sheetNum(path: string): number {
  return Number(/sheet(\d+)\.xml$/.exec(path)?.[1] ?? "0");
}

// Decode a zip entry to a string, but only if it's within the scan ceiling — a
// part larger than MAX_XML_SCAN_BYTES is refused (returns null) so we never
// regex-scan an oversized, possibly-crafted XML body.
function xmlPart(entry: Uint8Array | undefined): string | null {
  if (!entry || entry.length > MAX_XML_SCAN_BYTES) return null;
  return strFromU8(entry);
}

// Every `[^>]` / content run below is length-bounded (MAX_ATTR / MAX_CELL) so a
// crafted worksheet with no closing `>` can't trigger quadratic backtracking.
function parseSheetXml(
  xml: string,
  shared: string[],
  cellBudget: number,
): string[][] {
  const rows: string[][] = [];
  let budget = cellBudget;
  const cellRe = new RegExp(
    `<c\\b([^>]{0,${MAX_ATTR}})>([\\s\\S]{0,${MAX_CELL}}?)<\\/c>|<c\\b([^>]{0,${MAX_ATTR}})\\/>`,
    "g",
  );
  const vRe = new RegExp(`<v\\b[^>]{0,${MAX_ATTR}}>([\\s\\S]{0,${MAX_CELL}}?)<\\/v>`);
  const tRe = new RegExp(`<t\\b[^>]{0,${MAX_ATTR}}>([\\s\\S]{0,${MAX_CELL}}?)<\\/t>`, "g");
  for (const rowM of xml.matchAll(
    new RegExp(`<row\\b[^>]{0,${MAX_ATTR}}>([\\s\\S]{0,${MAX_XML_SCAN_BYTES}}?)<\\/row>`, "g"),
  )) {
    if (budget <= 0) break;
    const cells: string[] = [];
    // Each cell is <c ...>…</c> or a self-closing empty <c .../>.
    for (const cM of rowM[1]!.matchAll(cellRe)) {
      if (budget <= 0) break;
      budget--;
      const attrs = cM[1] ?? cM[3] ?? "";
      const inner = cM[2] ?? "";
      const t = /\bt="([^"]{0,64})"/.exec(attrs)?.[1];
      let value = "";
      if (t === "s") {
        // Shared-string index. Guard the empty-cell case explicitly — Number("")
        // is 0, which would otherwise resolve an empty cell to shared string #0.
        const raw = vRe.exec(inner)?.[1];
        const idx = raw != null ? Number(raw) : NaN;
        value = Number.isInteger(idx) ? (shared[idx] ?? "") : "";
      } else if (t === "inlineStr") {
        value = [...inner.matchAll(tRe)]
          .map((m) => decodeXmlEntities(m[1]!))
          .join("");
      } else {
        // t="str" (formula result) or a number/date — value lives in <v>.
        const v = vRe.exec(inner)?.[1];
        value = v != null ? decodeXmlEntities(v) : "";
      }
      cells.push(value);
    }
    rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Legacy binary .xls (OLE / BIFF). Parsing it safely needs a heavyweight
// dependency, so we can't read its cells — we return an empty `text`. With no
// text to verify from, the caller falls back to the vision model, which also
// can't open a binary .xls, so it's flagged as an unsupported format (the
// accountant reviews it and can ask the client to re-save as .xlsx or CSV).
// Almost every "Excel" file today is .xlsx, which is read in full above.
// ---------------------------------------------------------------------------

function extractLegacyXls(): ReadableExtraction {
  return {
    kind: "xls",
    text: "",
    char_count: 0,
    text_preview: "",
    extracted_year: null,
    sheet_names: null,
    row_count: null,
    column_headers: null,
  };
}

// ---------------------------------------------------------------------------
// PDF text layer (via unpdf's serverless pdf.js build). Dynamically imported so
// the pdf.js bundle only loads when a PDF is actually processed.
// ---------------------------------------------------------------------------

async function extractPdfText(bytes: Buffer): Promise<ReadableExtraction | null> {
  let totalPages = 0;
  let rawText = "";
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const res = await extractText(doc, { mergePages: true });
    totalPages = res.totalPages ?? 0;
    rawText = Array.isArray(res.text) ? res.text.join("\n") : (res.text ?? "");
  } catch (e) {
    // A password-protected, corrupt, or otherwise unreadable PDF lands here —
    // defer to the vision model rather than guess.
    console.warn("[readable] pdf text extraction failed:", e);
    return null;
  }

  const stripped = rawText.replace(/\s+/g, " ").trim();
  const alnum = (stripped.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const pages = Math.max(1, totalPages);
  // A born-digital PDF has a rich text layer; a scan/photo has ~none. NOTE: a
  // scan that was OCR'd into a "searchable PDF" DOES carry an extractable text
  // layer and will pass this test — by design, we treat it as readable (the
  // task's rule is "a real text layer", which OCR output satisfies). A blurry
  // scan yields little or garbled text and still falls back to the vision model
  // via the floor below. If OCR'd scans should instead get the AI usability
  // check, tighten this to also inspect for full-page raster images.
  const hasTextLayer =
    alnum >= MIN_PDF_TEXT_CHARS_TOTAL &&
    alnum / pages >= MIN_PDF_TEXT_CHARS_PER_PAGE;
  if (!hasTextLayer) return null; // scanned / image-only → vision model

  return {
    kind: "pdf_text",
    text: stripped.slice(0, MAX_CLASSIFY_TEXT),
    char_count: alnum,
    text_preview: stripped.slice(0, PREVIEW_CHARS),
    extracted_year: findYear(stripped),
    sheet_names: null,
    row_count: null,
    column_headers: null,
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function decodeUtf8(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// First plausible tax year (1990–2099) appearing in the text. The lookarounds
// keep it from matching inside a number — e.g. the "2019" in "2019.99" or
// "$12020" is not a year — since extracted_year is a display hint and a
// monetary token masquerading as a year would mislead.
function findYear(text: string): number | null {
  // Not preceded by a digit / decimal point / currency mark, not part of a
  // longer number, and not the integer part of a decimal amount (2020.50). A
  // trailing comma is fine — that's a CSV field separator, not a decimal.
  const m = text.match(/(?<![\d.,$])(199\d|20\d\d)(?!\.\d)(?!\d)/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1990 && y <= 2099 ? y : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    // Ampersand last so a literal "&amp;lt;" doesn't double-decode.
    .replace(/&amp;/g, "&");
}

function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

// ZIP local-file-header magic (PK\x03\x04, and the empty/spanned variants).
function isZip(b: Buffer): boolean {
  return (
    b.length >= 4 &&
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
  );
}

// OLE2 compound-file magic (legacy .xls / .doc / .ppt).
function isOle(b: Buffer): boolean {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return b.length >= 8 && sig.every((v, i) => b[i] === v);
}
