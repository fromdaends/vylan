// Streaming ZIP writer + filename sanitization.
//
// We hand-write the archive instead of using fflate's `zipSync`. zipSync
// allocates the ENTIRE archive as one in-memory buffer; on an engagement with
// many / large documents that allocation THROWS (the real cause of the
// "couldn't prepare the download" 500s — the route's try/catch turned a zipSync
// allocation failure into `{"error":"zip_failed"}`). streamZip() below writes
// the archive INCREMENTALLY to a ReadableStream: one file is held in memory at a
// time, the whole archive is never materialised at once, and the response
// streams (so it also dodges the ~4.5 MB buffered-response cap).
//
// macOS compatibility: we have each file's full bytes BEFORE writing its entry,
// so we put the CRC + size in a plain local file header — NO streaming "data
// descriptor" (general-purpose bit 3). Streaming zippers that don't know the
// size up front (archiver; fflate's streaming Zip) MUST use a data descriptor,
// and macOS Archive Utility chokes on those (the ".zip → .cpgz" expand loop).
// Hand-writing STORE entries keeps the output opening cleanly in Archive
// Utility, Windows Explorer, and `unzip` — validated with `ditto` (the engine
// behind Finder's Archive Utility).
//
// STORE (no compression): the payload is tax documents — PDFs and JPEGs, already
// compressed — so deflating buys ~nothing and only costs CPU. Per-entry size is
// assumed under the 4 GB ZIP32 limit (tax slips are KB–MB).

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

// --- CRC-32 (IEEE polynomial, the one ZIP uses) ----------------------------
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
// 1980-01-01 in DOS date format (year-1980 << 9 | month << 5 | day); time = 0.
const DOS_DATE = 0x0021;

// Local file header (30 bytes + name). STORE method; CRC + size are known up
// front, so the header is complete and there's NO data descriptor (bit 3 clear).
function localFileHeader(name: Uint8Array, crc: number, size: number): Uint8Array {
  const h = new Uint8Array(30 + name.length);
  const v = new DataView(h.buffer);
  v.setUint32(0, 0x04034b50, true); // local file header signature
  v.setUint16(4, 20, true); // version needed to extract (2.0)
  v.setUint16(6, 0, true); // general purpose flag (bit 3 CLEAR → no descriptor)
  v.setUint16(8, 0, true); // compression method = 0 (store)
  v.setUint16(10, 0, true); // last mod time
  v.setUint16(12, DOS_DATE, true); // last mod date
  v.setUint32(14, crc, true);
  v.setUint32(18, size, true); // compressed size (= uncompressed for store)
  v.setUint32(22, size, true); // uncompressed size
  v.setUint16(26, name.length, true);
  v.setUint16(28, 0, true); // extra field length
  h.set(name, 30);
  return h;
}

// Central directory file header (46 bytes + name).
function centralFileHeader(
  name: Uint8Array,
  crc: number,
  size: number,
  offset: number,
): Uint8Array {
  const h = new Uint8Array(46 + name.length);
  const v = new DataView(h.buffer);
  v.setUint32(0, 0x02014b50, true); // central file header signature
  v.setUint16(4, 20, true); // version made by
  v.setUint16(6, 20, true); // version needed
  v.setUint16(8, 0, true); // flags
  v.setUint16(10, 0, true); // method = store
  v.setUint16(12, 0, true); // mod time
  v.setUint16(14, DOS_DATE, true); // mod date
  v.setUint32(16, crc, true);
  v.setUint32(20, size, true); // compressed
  v.setUint32(24, size, true); // uncompressed
  v.setUint16(28, name.length, true);
  v.setUint16(30, 0, true); // extra len
  v.setUint16(32, 0, true); // comment len
  v.setUint16(34, 0, true); // disk number start
  v.setUint16(36, 0, true); // internal attrs
  v.setUint32(38, 0, true); // external attrs
  v.setUint32(42, offset, true); // relative offset of local header
  h.set(name, 46);
  return h;
}

// End of central directory record (22 bytes, no archive comment).
function endOfCentralDirectory(
  count: number,
  cdSize: number,
  cdOffset: number,
): Uint8Array {
  const h = new Uint8Array(22);
  const v = new DataView(h.buffer);
  v.setUint32(0, 0x06054b50, true); // EOCD signature
  v.setUint16(4, 0, true); // disk number
  v.setUint16(6, 0, true); // disk with central directory
  v.setUint16(8, count, true); // CD records on this disk
  v.setUint16(10, count, true); // total CD records
  v.setUint32(12, cdSize, true); // size of central directory
  v.setUint32(16, cdOffset, true); // offset of central directory
  v.setUint16(20, 0, true); // comment length
  return h;
}

/**
 * Build a ZIP **incrementally** and serve it as a ReadableStream: each entry is
 * written (local header + bytes) and released before the next is pulled, so peak
 * memory is ONE file — never the whole archive (which is what made zipSync throw
 * on big engagements). Entries are STOREd with complete headers (no data
 * descriptors) so the result opens in macOS Archive Utility, Windows, and
 * `unzip`. Duplicate names get a " (n)" suffix. The caller's generator should
 * skip a file it can't fetch (yield nothing for it); a genuine throw here errors
 * the stream (the download just fails, as before).
 */
export function streamZip(
  entries: AsyncIterable<ZipEntry>,
): ReadableStream<Uint8Array> {
  const iter = entries[Symbol.asyncIterator]();
  const seen = new Map<string, number>();
  const central: Uint8Array[] = [];
  let offset = 0; // bytes written so far (= next entry's local-header offset)
  let count = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iter.next();
        if (next.done) {
          // Footer: the central directory, then the End Of Central Directory.
          const cdOffset = offset;
          let cdSize = 0;
          for (const rec of central) {
            controller.enqueue(rec);
            cdSize += rec.byteLength;
          }
          controller.enqueue(endOfCentralDirectory(count, cdSize, cdOffset));
          controller.close();
          return;
        }

        let name = next.value.name || "untitled";
        const n = seen.get(name) ?? 0;
        seen.set(name, n + 1);
        if (n > 0) name = suffixName(name, n);
        const nameBytes = utf8(name);
        const data = next.value.data;
        const crc = crc32(data);

        const header = localFileHeader(nameBytes, crc, data.byteLength);
        controller.enqueue(header);
        controller.enqueue(data);
        central.push(centralFileHeader(nameBytes, crc, data.byteLength, offset));
        offset += header.byteLength + data.byteLength;
        count += 1;
      } catch (e) {
        controller.error(e);
      }
    },
    cancel() {
      // Client aborted the download — let the source generator stop fetching.
      void iter.return?.();
    },
  });
}

/**
 * Build the whole archive into a single Uint8Array by draining streamZip.
 *
 * Why this exists alongside streamZip: returning a hand-constructed
 * ReadableStream as a Response body crashes Vercel's Node serverless runtime
 * (it pipes a native fetch-body stream fine — /api/files/[id] — but throws an
 * instant 500 on a JS-built ReadableStream). So the bulk-download route builds
 * the bytes with this and returns a plain BUFFERED response, which is the
 * standard, reliable mechanism. The construction is still incremental
 * (streamZip releases each file as it goes); we just collect the chunks here.
 * Suitable for the modest archives this app produces (a handful of tax docs).
 */
export async function zipToBytes(
  entries: AsyncIterable<ZipEntry>,
): Promise<Uint8Array> {
  const reader = streamZip(entries).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
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
