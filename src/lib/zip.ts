// ZIP building primitive + filename sanitization.
//
// We use fflate's `zipSync` (not archiver) for two reasons:
//
//   1. macOS compatibility. zipSync has every file's bytes up front, so it
//      writes each entry's CRC + size into a plain local file header — NO
//      streaming "data descriptor" (general-purpose bit 3). Streaming zippers
//      (archiver, fflate's streaming Zip) can't know the size up front so they
//      MUST use a data descriptor, and macOS Archive Utility frequently fails
//      on those — the classic ".zip → .cpgz → .zip" expand loop. zipSync's
//      output opens cleanly in Archive Utility, Windows Explorer, and `unzip`.
//
//   2. archiver 8.x dropped its callable `archiver("zip", …)` factory (it now
//      exports ESM classes only), which silently broke our old call at runtime
//      while the stale @types/archiver kept the build green. Moving to fflate
//      removes that landmine.
//
// Trade-off: zipSync builds the whole archive in memory. Our archives are
// individual tax documents (single-digit MB each, a handful per engagement;
// the firm export is owner-only + rate-limited), so the peak is modest. If a
// future use case needs giant archives, revisit with a chunked approach.

import { zipSync } from "fflate";

export type ZipEntry = {
  /** Filename inside the ZIP. Forward slashes create folders. */
  name: string;
  /** The file's full contents. */
  data: Uint8Array;
};

// Insert a " (n)" disambiguator before the extension: "x.pdf" → "x (1).pdf".
// Used to keep colliding entry names unique (a Record can't hold duplicates).
function suffixName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  if (dot > 0) return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
  return `${name} (${n})`;
}

/**
 * Consume an async stream of entries and build a single ZIP archive (returned
 * as bytes). Duplicate entry names are disambiguated with a " (n)" suffix so
 * every file survives. Throws if fflate rejects an entry; callers surface that
 * as a failed download.
 */
export async function buildZipArchive(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  // 0 = STORE (no compression). Our payload is tax documents — PDFs and JPEGs,
  // which are ALREADY compressed — so deflating them buys ~nothing in size but
  // burns real CPU and time. Storing keeps the single-shot in-memory build fast
  // and well under the route's time budget (level-6 deflate of a big, heavily
  // re-uploaded engagement is what was timing the bulk download out). Callers
  // can opt back into deflate (1-9) if they ever zip compressible content.
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 0,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const seen = new Map<string, number>();
  for await (const entry of entries) {
    let name = entry.name;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n > 0) name = suffixName(name, n);
    files[name] = entry.data;
  }
  return zipSync(files, { level });
}

/**
 * Serve an in-memory archive as a STREAMED response body, not one buffered blob.
 *
 * Why this exists: the hosting platform caps a BUFFERED Serverless-Function
 * response at ~4.5 MB (the same cap the chunked-upload flow dodges on the way
 * IN). Returning `new Response(zipBytes)` — a single Uint8Array with a fixed
 * Content-Length — trips that cap the moment an engagement's documents total
 * more than ~4.5 MB, which is why "Download all" failed on real engagements. A
 * response whose body is a ReadableStream is delivered chunked and is NOT
 * subject to that cap — exactly how single-file download (/api/files/[id])
 * already serves large files. The archive is still built whole in memory (so it
 * keeps the macOS-openable zipSync format); we just hand it out in chunks.
 *
 * 256 KB chunks balance per-chunk overhead against churn. `subarray` is a view
 * (no copy). Lazy `pull` means we only enqueue as the client drains.
 */
export function zipToStream(
  bytes: Uint8Array,
  chunkSize = 256 * 1024,
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

/**
 * Sanitize a string for use as part of a downloadable filename.
 * - Strips ASCII control characters.
 * - Removes path separators and Windows-reserved characters outright
 *   (replacing with `_` left junk in the output and never produced the
 *   "untitled" fallback for inputs like `///`).
 * - Strips leading dots (no hidden files).
 * - Collapses runs of whitespace.
 * - Hard-caps length so the OS doesn't reject the download.
 */
export function sanitizeFilenamePart(input: string, maxLen = 80): string {
  // Order matters: collapse whitespace first so tabs/newlines (which
  // ARE control characters) become spaces. The follow-up control-char
  // strip then only hits weird bytes like 0x07 (bell).
  const cleaned = input
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return cleaned.slice(0, maxLen) || "untitled";
}

/**
 * Sanitize ONE ZIP entry name segment (no folders) for maximum unzip
 * compatibility — macOS Archive Utility in particular. On top of
 * sanitizeFilenamePart this also transliterates accents to ASCII
 * ("Hydro-Québec" → "Hydro-Quebec") and drops any remaining non-ASCII, so the
 * archive never depends on the reader honouring the UTF-8 filename flag (fflate
 * doesn't set it). The file extension is preserved (lower-cased) so files still
 * open by type.
 *
 * Note: this is for the bytes WRITTEN INTO the archive. The pretty, accented
 * name still lives on the file's display_name and is used for single-file
 * (UTF-8 Content-Disposition) downloads.
 */
export function macZipEntryName(
  input: string | null | undefined,
  maxLen = 120,
): string {
  // Decompose accents (é → "e" + a combining mark), then strip everything
  // outside printable ASCII — that removes the combining marks (leaving the
  // base letter) plus any other non-ASCII (emoji, CJK, …). A null/undefined
  // name (a file with neither a display_name nor an original_filename) collapses
  // to the "untitled" fallback below instead of throwing on .normalize().
  const ascii = (input ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "");

  // Preserve a real extension (short alphanumeric tail) so type is kept.
  const dot = ascii.lastIndexOf(".");
  const hasExt =
    dot > 0 &&
    dot < ascii.length - 1 &&
    /^[A-Za-z0-9]{1,8}$/.test(ascii.slice(dot + 1));
  const rawBase = hasExt ? ascii.slice(0, dot) : ascii;
  const ext = hasExt ? `.${ascii.slice(dot + 1).toLowerCase()}` : "";

  const base = sanitizeFilenamePart(rawBase, maxLen - ext.length);
  // base is never empty (sanitizeFilenamePart falls back to "untitled").
  return `${base}${ext}`;
}
