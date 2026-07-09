// Code-readable fast path — read a document's data in code, with NO vision model.
//
// Some uploads are machine-readable by definition: a PDF that carries a real
// text layer, an Excel workbook (.xlsx / .xls), or a CSV. Their contents are
// already text / structured data, so spending a GPT-5.4 vision call to "read"
// them is wasted — code can pull the fields out directly. This module detects
// those files and extracts their data locally, so processClassifyJob can skip
// the (paid) AI classification for them and let them flow through the portal as
// normal ("submitted / awaiting accountant approval").
//
// Anything code CANNOT read — a scanned or photographed PDF with no text layer,
// an image, a blurry capture — returns null from extractReadable() and falls
// through to the existing AI vision path untouched. That is the whole rule:
// readable → code path (no AI); not readable → AI path, exactly as before.

import { unzipSync, strFromU8 } from "fflate";
import { parseCsv } from "@/lib/csv";
import { CODE_READ_SOURCE } from "./code-read";

// Re-exported so the fast-path writer (process.ts) and this extractor share the
// single marker definition in ./code-read (which is client-safe, unlike this
// module — it pulls in the PDF/zip parsers).
export const CODE_SOURCE = CODE_READ_SOURCE;

export type ReadableKind = "pdf_text" | "xlsx" | "xls" | "csv";

export type ReadableExtraction = {
  kind: ReadableKind;
  // Count of extractable alphanumeric characters — this is what the PDF
  // text-layer test is gated on (a scanned/image-only PDF yields ~0 here).
  char_count: number;
  // First slice of the readable content, so the accountant can eyeball exactly
  // what code read off the document.
  text_preview: string;
  // Best-effort 4-digit tax year read off the text (null when none is present).
  extracted_year: number | null;
  // Spreadsheet / CSV shape. Null for PDFs.
  sheet_names: string[] | null;
  row_count: number | null;
  column_headers: string[] | null;
};

// How much of the extracted text we keep as a preview (accountant-facing).
const PREVIEW_CHARS = 2000;

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
    files = unzipSync(new Uint8Array(bytes));
  } catch {
    return null; // corrupt/invalid zip → defer to the AI path
  }

  // Shared strings: most text cells store an index into this table. An <si>
  // item may hold several <t> runs (rich text) — concatenate them.
  const shared: string[] = [];
  const ss = files["xl/sharedStrings.xml"];
  if (ss) {
    const xml = strFromU8(ss);
    for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const runs = [...si[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) =>
        decodeXmlEntities(m[1]!),
      );
      shared.push(runs.join(""));
    }
  }

  // Sheet names (display order) off the workbook part.
  const sheetNames: string[] = [];
  const wb = files["xl/workbook.xml"];
  if (wb) {
    const xml = strFromU8(wb);
    for (const m of xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)) {
      sheetNames.push(decodeXmlEntities(m[1]!));
    }
  }

  const sheetPaths = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => sheetNum(a) - sheetNum(b));

  const textParts: string[] = [];
  let firstSheetRows: string[][] = [];
  for (const path of sheetPaths) {
    const rows = parseSheetXml(strFromU8(files[path]!), shared);
    if (path === sheetPaths[0]) firstSheetRows = rows;
    for (const row of rows) textParts.push(row.join("\t"));
  }

  const text = textParts.join("\n");
  const headers = firstSheetRows.length > 0 ? firstSheetRows[0]! : [];
  return {
    kind: "xlsx",
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

function parseSheetXml(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowM of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    // Each cell is <c ...>…</c> or a self-closing empty <c .../>.
    for (const cM of rowM[1]!.matchAll(
      /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g,
    )) {
      const attrs = cM[1] ?? cM[3] ?? "";
      const inner = cM[2] ?? "";
      const t = /\bt="([^"]*)"/.exec(attrs)?.[1];
      let value = "";
      if (t === "s") {
        // Shared-string index. Guard the empty-cell case explicitly — Number("")
        // is 0, which would otherwise resolve an empty cell to shared string #0.
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const idx = raw != null ? Number(raw) : NaN;
        value = Number.isInteger(idx) ? (shared[idx] ?? "") : "";
      } else if (t === "inlineStr") {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map((m) => decodeXmlEntities(m[1]!))
          .join("");
      } else {
        // t="str" (formula result) or a number/date — value lives in <v>.
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
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
// dependency, so we don't read cell data — but it still does NOT need the
// vision model, so we treat it as code-readable (skip the AI) with a best-effort
// (empty) extraction. Most "Excel" files today are .xlsx, read in full above.
// ---------------------------------------------------------------------------

function extractLegacyXls(): ReadableExtraction {
  return {
    kind: "xls",
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
  const hasTextLayer =
    alnum >= MIN_PDF_TEXT_CHARS_TOTAL &&
    alnum / pages >= MIN_PDF_TEXT_CHARS_PER_PAGE;
  if (!hasTextLayer) return null; // scanned / image-only → vision model

  return {
    kind: "pdf_text",
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

// First plausible tax year (1990–2099) appearing in the text.
function findYear(text: string): number | null {
  const m = text.match(/\b(199\d|20\d\d)\b/);
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
