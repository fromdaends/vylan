// ZIP streaming primitive + filename sanitization.
//
// `archiver` is Node-streams native. Next.js / Vercel route handlers
// return a Web `Response` with a Web `ReadableStream` body. We bridge
// the two with `Readable.toWeb()` so the route handler can pipe a ZIP
// straight to the client without buffering the whole archive in
// memory.
//
// Each entry is consumed lazily — we kick off the archiver pump in a
// detached async task and return the Web stream synchronously. If a
// per-entry stream fails mid-pump, the archiver finalize() rejects and
// the consumer sees a truncated body; that's the same behaviour as
// any other "stream died mid-flight" response and is acceptable for
// bulk-download UX (browser shows a partial file the user can retry).

import { Readable } from "node:stream";
import archiver from "archiver";

export type ZipEntry = {
  /** Filename inside the ZIP. Forward slashes create folders. */
  name: string;
  /** Stream of bytes for the file's contents. */
  stream: Readable;
  /** Optional byte size — passed to archiver as a hint. */
  size?: number;
};

export function streamZip(
  entries: AsyncIterable<ZipEntry>,
): ReadableStream<Uint8Array> {
  // Level 6 = default compression. Level 9 wastes CPU on already-
  // compressed inputs (JPEG, PDF) which dominate our payload.
  const archive = archiver("zip", { zlib: { level: 6 } });

  // archiver streams as a normal Node Readable.
  const webStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

  // Pump entries in the background. Errors are forwarded to archive,
  // which propagates them to the Web stream consumer as a stream
  // error — the route handler's Response stream surfaces that to
  // the client as a closed connection.
  (async () => {
    try {
      for await (const entry of entries) {
        archive.append(entry.stream, {
          name: entry.name,
          ...(entry.size !== undefined ? { stats: { size: entry.size } as never } : {}),
        });
      }
      await archive.finalize();
    } catch (err) {
      console.error("[zip] streaming aborted:", err);
      try {
        archive.abort();
      } catch {
        // best-effort; archiver may already be done.
      }
    }
  })();

  return webStream;
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
