import { describe, it, expect } from "vitest";
import {
  sanitizeFilenamePart,
  macZipEntryName,
  streamZip,
  type ZipEntry,
} from "./zip";

// Walk the ZIP's central directory (via the End Of Central Directory record)
// and return each entry's name + whether it uses a streaming data descriptor
// (general-purpose bit 3). Navigating by the directory offsets is robust
// against header signatures appearing inside compressed data.
function centralDirectory(zip: Uint8Array): { name: string; usesDataDescriptor: boolean }[] {
  const b = Buffer.from(zip);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("no End Of Central Directory record");
  const total = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: { name: string; usesDataDescriptor: boolean }[] = [];
  for (let n = 0; n < total; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central header");
    const flag = b.readUInt16LE(p + 8);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    out.push({
      name: b.toString("utf8", p + 46, p + 46 + nameLen),
      usesDataDescriptor: Boolean(flag & 0x08),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Extract STORE entries: central directory -> each local-header offset -> the
// raw stored bytes. Proves the archive's CONTENTS, not just its structure.
function extractStored(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const b = Buffer.from(zip);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("no End Of Central Directory record");
  const total = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: { name: string; data: Uint8Array }[] = [];
  for (let n = 0; n < total; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central header");
    const size = b.readUInt32LE(p + 24); // uncompressed (= compressed for store)
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const lho = b.readUInt32LE(p + 42); // local header offset
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);
    const lhNameLen = b.readUInt16LE(lho + 26);
    const lhExtraLen = b.readUInt16LE(lho + 28);
    const start = lho + 30 + lhNameLen + lhExtraLen;
    out.push({ name, data: new Uint8Array(zip.subarray(start, start + size)) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return { out, chunkCount: chunks.length };
}

async function* gen(entries: ZipEntry[]): AsyncGenerator<ZipEntry> {
  for (const e of entries) yield e;
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("sanitizeFilenamePart", () => {
  it("removes slashes and backslashes outright", () => {
    expect(sanitizeFilenamePart("a/b\\c")).toBe("abc");
  });

  it("removes Windows-reserved characters outright", () => {
    expect(sanitizeFilenamePart('foo<bar>:"|?*')).toBe("foobar");
  });

  it("strips leading dots so the result isn't a hidden file", () => {
    expect(sanitizeFilenamePart("...hidden")).toBe("hidden");
    expect(sanitizeFilenamePart(".env")).toBe("env");
  });

  it("collapses whitespace runs (including tabs/newlines) to a single space", () => {
    expect(sanitizeFilenamePart("a   b\t\nc")).toBe("a b c");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeFilenamePart("   hi   ")).toBe("hi");
  });

  it("strips ASCII control characters (bell, backspace, etc.)", () => {
    expect(sanitizeFilenamePart("hi\x07the\x08re")).toBe("hithere");
  });

  it("hard-caps length to the supplied max", () => {
    const long = "a".repeat(200);
    expect(sanitizeFilenamePart(long, 50)).toHaveLength(50);
  });

  it("falls back to 'untitled' when sanitization empties the input", () => {
    expect(sanitizeFilenamePart("///")).toBe("untitled");
    expect(sanitizeFilenamePart("...")).toBe("untitled");
    expect(sanitizeFilenamePart("")).toBe("untitled");
  });

  it("preserves accented characters and dashes", () => {
    expect(sanitizeFilenamePart("Tremblay-Côté")).toBe("Tremblay-Côté");
  });
});

describe("macZipEntryName", () => {
  it("transliterates accents to ASCII and keeps the extension", () => {
    expect(macZipEntryName("Hydro-Québec.pdf")).toBe("Hydro-Quebec.pdf");
    expect(macZipEntryName("Tremblay-Côté.PDF")).toBe("Tremblay-Cote.pdf");
  });

  it("lower-cases the extension but leaves the base name's case", () => {
    expect(macZipEntryName("T4 - 2024 - ACME.PDF")).toBe("T4 - 2024 - ACME.pdf");
  });

  it("drops non-Latin / emoji and collapses the gap it leaves", () => {
    expect(macZipEntryName("reçu 🧾 café.jpg")).toBe("recu cafe.jpg");
  });

  it("removes path separators (and leading dots) so an entry can't escape its folder", () => {
    expect(macZipEntryName("../../etc/passwd.pdf")).toBe("etcpasswd.pdf");
  });

  it("keeps a name that has no extension", () => {
    expect(macZipEntryName("scan-document")).toBe("scan-document");
  });

  it("does not treat a long dotted tail as an extension", () => {
    expect(macZipEntryName("notes.superlongword")).toBe("notes.superlongword");
  });

  it("falls back to 'untitled' when the whole name sanitizes to nothing", () => {
    expect(macZipEntryName("✦✦✦")).toBe("untitled");
  });

  it("is null-safe: a missing name falls back instead of throwing", () => {
    // A file with neither a display_name nor an original_filename used to crash
    // the whole bulk download on .normalize() of undefined.
    expect(macZipEntryName(null)).toBe("untitled");
    expect(macZipEntryName(undefined)).toBe("untitled");
    expect(macZipEntryName("")).toBe("untitled");
  });
});

describe("streamZip (incremental, macOS-openable, bounded-memory)", () => {
  it("produces a valid ZIP (local file header + EOCD) and round-trips contents", async () => {
    const { out } = await drain(
      streamZip(
        gen([
          { name: "T4 - 2024.pdf", data: bytes("employment income") },
          { name: "folder/RL-1 - 2024.pdf", data: bytes("releve un") },
        ]),
      ),
    );
    expect(Buffer.from(out).readUInt32LE(0)).toBe(0x04034b50); // PK\x03\x04
    const dir = centralDirectory(out);
    expect(dir.map((e) => e.name)).toEqual([
      "T4 - 2024.pdf",
      "folder/RL-1 - 2024.pdf",
    ]);
    const extracted = extractStored(out);
    expect(extracted.map((e) => e.name)).toEqual([
      "T4 - 2024.pdf",
      "folder/RL-1 - 2024.pdf",
    ]);
    expect(new TextDecoder().decode(extracted[0]!.data)).toBe("employment income");
    expect(new TextDecoder().decode(extracted[1]!.data)).toBe("releve un");
  });

  it("writes NO data descriptor: every entry has general-purpose bit 3 clear (macOS-safe)", async () => {
    const { out } = await drain(
      streamZip(
        gen([
          { name: "a.pdf", data: bytes("one") },
          { name: "b.pdf", data: bytes("two") },
        ]),
      ),
    );
    for (const e of centralDirectory(out)) {
      expect(e.usesDataDescriptor).toBe(false);
    }
  });

  it("de-duplicates colliding entry names with a ' (n)' suffix, keeping each file's bytes", async () => {
    const { out } = await drain(
      streamZip(
        gen([
          { name: "T4 - 2024.pdf", data: bytes("a") },
          { name: "T4 - 2024.pdf", data: bytes("b") },
          { name: "T4 - 2024.pdf", data: bytes("c") },
        ]),
      ),
    );
    expect(centralDirectory(out).map((e) => e.name)).toEqual([
      "T4 - 2024.pdf",
      "T4 - 2024 (1).pdf",
      "T4 - 2024 (2).pdf",
    ]);
    expect(
      extractStored(out).map((e) => new TextDecoder().decode(e.data)),
    ).toEqual(["a", "b", "c"]);
  });

  it("produces a valid EMPTY archive when there are no entries", async () => {
    const { out } = await drain(streamZip(gen([])));
    expect(out.length).toBe(22); // EOCD only
    expect(Buffer.from(out).readUInt32LE(0)).toBe(0x06054b50);
    expect(centralDirectory(out)).toEqual([]);
  });

  it("handles a single entry far larger than the old in-memory build, content intact", async () => {
    // ~12MB single file. The old zipSync path allocated the WHOLE archive at
    // once (what threw on big engagements); streamZip writes it incrementally,
    // in multiple chunks. Also bigger than the ~4.5MB buffered-response cap.
    const big = new Uint8Array(12 * 1024 * 1024 + 123);
    for (let i = 0; i < big.length; i++) big[i] = (i * 73) & 0xff;
    const { out, chunkCount } = await drain(
      streamZip(gen([{ name: "big.bin", data: big }])),
    );
    expect(chunkCount).toBeGreaterThan(1); // streamed in pieces, not one blob
    const extracted = extractStored(out);
    expect(extracted).toHaveLength(1);
    expect(Buffer.from(extracted[0]!.data).equals(Buffer.from(big))).toBe(true);
  });

  it("emits each entry's header + data as it goes (incremental, not one buffer)", async () => {
    const { chunkCount } = await drain(
      streamZip(
        gen([
          { name: "a", data: bytes("aaa") },
          { name: "b", data: bytes("bbb") },
          { name: "c", data: bytes("ccc") },
        ]),
      ),
    );
    // 3 entries x (header + data) + footer => well more than one chunk.
    expect(chunkCount).toBeGreaterThanOrEqual(4);
  });
});
