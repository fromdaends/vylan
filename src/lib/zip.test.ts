import { describe, it, expect } from "vitest";
import {
  sanitizeFilenamePart,
  macZipEntryName,
  buildZipArchive,
  zipToStream,
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

describe("buildZipArchive (macOS-openable format)", () => {
  it("produces a valid ZIP (starts with a local file header)", async () => {
    const zip = await buildZipArchive(
      gen([{ name: "a.txt", data: bytes("hello world") }]),
    );
    expect(zip.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(zip).readUInt32LE(0)).toBe(0x04034b50); // PK\x03\x04
  });

  it("accepts a plain array of entries (sync iterable), not just an async stream", async () => {
    // The bulk-download route now collects entries into an array (via bounded
    // parallel fetch) and passes that array straight in.
    const zip = await buildZipArchive([
      { name: "a.txt", data: bytes("hello") },
      { name: "b.txt", data: bytes("world") },
    ]);
    expect(Buffer.from(zip).readUInt32LE(0)).toBe(0x04034b50);
    const dir = centralDirectory(zip);
    expect(dir.map((e) => e.name)).toEqual(["a.txt", "b.txt"]);
    for (const e of dir) expect(e.usesDataDescriptor).toBe(false);
  });

  it("writes NO streaming data descriptor — every entry has GP bit 3 clear", async () => {
    // The macOS Archive Utility fix: fflate's zipSync writes the CRC + size in
    // each local header (no data descriptor / no ".zip → .cpgz" loop).
    const zip = await buildZipArchive(
      gen([
        { name: "T4 - 2024.pdf", data: bytes("one") },
        { name: "folder/RL-1 - 2024.pdf", data: bytes("two") },
      ]),
    );
    const dir = centralDirectory(zip);
    expect(dir.map((e) => e.name)).toEqual(["T4 - 2024.pdf", "folder/RL-1 - 2024.pdf"]);
    for (const e of dir) expect(e.usesDataDescriptor).toBe(false);
  });

  it("de-duplicates colliding entry names with a ' (n)' suffix", async () => {
    const zip = await buildZipArchive(
      gen([
        { name: "T4 - 2024.pdf", data: bytes("a") },
        { name: "T4 - 2024.pdf", data: bytes("b") },
        { name: "T4 - 2024.pdf", data: bytes("c") },
      ]),
    );
    const names = centralDirectory(zip).map((e) => e.name);
    expect(names).toEqual(["T4 - 2024.pdf", "T4 - 2024 (1).pdf", "T4 - 2024 (2).pdf"]);
  });
});

describe("zipToStream (streamed response — dodges the ~4.5MB buffered-body cap)", () => {
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

  it("streams a >4.5MB archive back byte-for-byte across many chunks", async () => {
    // Bigger than the platform's buffered-response cap — the exact case the
    // stream exists to handle. Deterministic content so we can compare exactly.
    const big = new Uint8Array(5 * 1024 * 1024 + 777);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;

    const { out, chunkCount } = await drain(zipToStream(big, 256 * 1024));

    expect(chunkCount).toBeGreaterThan(1); // genuinely chunked, not one blob
    expect(out.length).toBe(big.length);
    expect(Buffer.from(out).equals(Buffer.from(big))).toBe(true);
  });

  it("preserves a real (small) archive exactly", async () => {
    const zip = await buildZipArchive([{ name: "a.txt", data: bytes("hello") }]);
    const { out } = await drain(zipToStream(zip));
    expect(Buffer.from(out).equals(Buffer.from(zip))).toBe(true);
    // still a valid zip after the round-trip
    expect(Buffer.from(out).readUInt32LE(0)).toBe(0x04034b50);
  });

  it("closes cleanly on an empty archive", async () => {
    const { out, chunkCount } = await drain(zipToStream(new Uint8Array(0)));
    expect(out.length).toBe(0);
    expect(chunkCount).toBe(0);
  });
});
