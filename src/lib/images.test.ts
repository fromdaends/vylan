import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import {
  ImageProcessError,
  isAcceptedBrandingMime,
  processImageUpload,
} from "./images";

// Mock the storage HEIC pipeline so tests don't shell out to a native decoder.
vi.mock("@/lib/storage", async () => {
  const actual =
    await vi.importActual<typeof import("./storage")>("@/lib/storage");
  return {
    ...actual,
    convertHeicToJpeg: vi.fn(async (input: Buffer | ArrayBuffer) => {
      // Stand-in: pretend the HEIC body is just a JPEG already. The test
      // never gives us a real HEIC; we just need the code path executed.
      const buf = Buffer.isBuffer(input)
        ? input
        : Buffer.from(new Uint8Array(input));
      return buf;
    }),
  };
});

async function makeFile(opts: {
  mime: string;
  width?: number;
  height?: number;
  size?: number;
  format?: "png" | "jpeg" | "webp" | "raw";
}): Promise<File> {
  const width = opts.width ?? 100;
  const height = opts.height ?? 100;
  const format = opts.format ?? "png";

  let body: Buffer;
  if (format === "raw") {
    body = Buffer.from("not a real image");
  } else {
    let pipeline = sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 30, g: 60, b: 200, alpha: 1 },
      },
    });
    if (format === "png") pipeline = pipeline.png();
    else if (format === "jpeg") pipeline = pipeline.jpeg();
    else pipeline = pipeline.webp();
    body = await pipeline.toBuffer();
  }

  // If caller specifies a size, pad with zeros to reach it. Used to trigger
  // the size-cap branch without burning real image bytes.
  if (opts.size && opts.size > body.length) {
    body = Buffer.concat([body, Buffer.alloc(opts.size - body.length)]);
  }

  return new File([new Uint8Array(body)], "test." + format, {
    type: opts.mime,
  });
}

describe("isAcceptedBrandingMime", () => {
  it("accepts jpeg/png/webp/heic/heif", () => {
    expect(isAcceptedBrandingMime("image/jpeg")).toBe(true);
    expect(isAcceptedBrandingMime("image/png")).toBe(true);
    expect(isAcceptedBrandingMime("image/webp")).toBe(true);
    expect(isAcceptedBrandingMime("image/heic")).toBe(true);
    expect(isAcceptedBrandingMime("image/heif")).toBe(true);
  });
  it("rejects gif/pdf/empty", () => {
    expect(isAcceptedBrandingMime("image/gif")).toBe(false);
    expect(isAcceptedBrandingMime("application/pdf")).toBe(false);
    expect(isAcceptedBrandingMime("")).toBe(false);
  });
});

describe("processImageUpload", () => {
  const opts = { maxBytes: 8 * 1024 * 1024, outputSize: 512 };

  it("converts a PNG into a 512×512 JPEG", async () => {
    const file = await makeFile({ mime: "image/png", format: "png" });
    const out = await processImageUpload(file, opts);
    expect(Buffer.isBuffer(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it("converts a JPEG into a 512×512 JPEG", async () => {
    const file = await makeFile({ mime: "image/jpeg", format: "jpeg" });
    const out = await processImageUpload(file, opts);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(512);
  });

  it("converts a WEBP into a 512×512 JPEG", async () => {
    const file = await makeFile({ mime: "image/webp", format: "webp" });
    const out = await processImageUpload(file, opts);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("center-crops a wide image to a square", async () => {
    const file = await makeFile({
      mime: "image/png",
      format: "png",
      width: 1024,
      height: 200,
    });
    const out = await processImageUpload(file, opts);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it("runs HEIC through convertHeicToJpeg", async () => {
    // The mock returns the bytes as-is, so we feed it real JPEG bytes labeled
    // as HEIC. After the mock "decodes", sharp re-encodes the JPEG.
    const fakeHeic = await makeFile({
      mime: "image/heic",
      format: "jpeg",
    });
    const out = await processImageUpload(fakeHeic, opts);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(512);
  });

  it("rejects an empty file", async () => {
    const empty = new File([], "x.png", { type: "image/png" });
    await expect(processImageUpload(empty, opts)).rejects.toBeInstanceOf(
      ImageProcessError,
    );
    await expect(processImageUpload(empty, opts)).rejects.toMatchObject({
      code: "empty",
    });
  });

  it("rejects a file over maxBytes before any decode work", async () => {
    const big = await makeFile({
      mime: "image/png",
      format: "png",
      size: 9 * 1024 * 1024, // > 8 MB
    });
    await expect(processImageUpload(big, opts)).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("rejects a disallowed MIME", async () => {
    const gif = new File([new Uint8Array(Buffer.from("GIF89a"))], "x.gif", {
      type: "image/gif",
    });
    await expect(processImageUpload(gif, opts)).rejects.toMatchObject({
      code: "bad_mime",
    });
  });

  it("rejects malformed image bytes labelled as a valid MIME", async () => {
    const garbage = await makeFile({
      mime: "image/png",
      format: "raw",
    });
    await expect(processImageUpload(garbage, opts)).rejects.toMatchObject({
      code: "resize_failed",
    });
  });
});
