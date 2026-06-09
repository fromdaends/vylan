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
  entries: AsyncIterable<ZipEntry>,
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
  // level 6 = balanced. Most of our payload (PDF/JPEG) is already compressed,
  // so this mostly just packages; fflate is fast enough that it's not worth
  // per-file tuning.
  return zipSync(files, { level: 6 });
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
export function macZipEntryName(input: string, maxLen = 120): string {
  // Decompose accents (é → "e" + a combining mark), then strip everything
  // outside printable ASCII — that removes the combining marks (leaving the
  // base letter) plus any other non-ASCII (emoji, CJK, …).
  const ascii = input
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
