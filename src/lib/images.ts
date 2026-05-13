// Image processing for branding uploads (firm logo, user avatar).
//
// Pipeline: validate size → if HEIC, decode to JPEG via heic-convert → run
// through sharp to honor EXIF orientation, center-crop, resize, and re-encode
// as a fixed-size JPEG. Output is a Buffer ready to hand to `uploadObject`.
//
// Why sharp: native libvips, handles every common image format, fast enough
// for a 512×512 resize on a Vercel function (< 100ms in practice). Honors
// EXIF rotation automatically with `.rotate()` (without arguments) — iPhone
// photos commonly arrive sideways without this.

import sharp from "sharp";
import { isHeic, convertHeicToJpeg } from "@/lib/storage";

export type ProcessImageOpts = {
  maxBytes: number;
  outputSize: number;
};

export class ImageProcessError extends Error {
  constructor(
    public readonly code:
      | "empty"
      | "too_large"
      | "bad_mime"
      | "decode_failed"
      | "resize_failed",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ImageProcessError";
  }
}

const ACCEPTED_INPUT_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export function isAcceptedBrandingMime(mime: string): boolean {
  return ACCEPTED_INPUT_MIMES.has(mime.toLowerCase());
}

/**
 * Validate, decode, square-center-crop, resize, and re-encode a user-uploaded
 * branding image into a fixed-size JPEG buffer.
 *
 * - Rejects empty or oversized inputs before doing any decode work.
 * - HEIC/HEIF inputs go through the existing `convertHeicToJpeg` helper first
 *   (15s timeout, OOM-safe).
 * - sharp's `.rotate()` (no args) reads EXIF orientation so iPhone uploads
 *   come out right-side up.
 * - `fit: "cover", position: "centre"` produces a square that always fills
 *   the output with the most visually-centered crop of the source.
 */
export async function processImageUpload(
  file: File,
  opts: ProcessImageOpts,
): Promise<Buffer> {
  if (!file || file.size === 0) {
    throw new ImageProcessError("empty");
  }
  if (file.size > opts.maxBytes) {
    throw new ImageProcessError("too_large");
  }
  if (!isAcceptedBrandingMime(file.type)) {
    throw new ImageProcessError("bad_mime");
  }

  const arrayBuffer = await file.arrayBuffer();
  let buf: Buffer = Buffer.from(arrayBuffer);

  if (isHeic(file.type)) {
    try {
      buf = await convertHeicToJpeg(buf);
    } catch {
      throw new ImageProcessError("decode_failed", "heic_decode_failed");
    }
  }

  try {
    const out = await sharp(buf)
      .rotate()
      .resize(opts.outputSize, opts.outputSize, {
        fit: "cover",
        position: "centre",
      })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return out;
  } catch {
    throw new ImageProcessError("resize_failed");
  }
}
