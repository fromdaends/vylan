// Render a small JPEG thumbnail of a stored IMAGE, shared by the accountant
// Preview grid (api/files/[id]/thumb) and the client portal (api/portal/files/
// [id]/thumb). Keeping the sign -> fetch -> decode -> resize pipeline in one
// place means the HEIC handling and the EXIF-rotation fix live in exactly one
// spot. The CALLER is responsible for authorization; this helper only renders.

import { signedUrl } from "@/lib/storage";
import sharp from "sharp";
import convert from "heic-convert";

// Default ~2x the on-screen tile so retina screens stay crisp; the enlarge view
// passes a larger ?w= for a readable full image. Width-only resize keeps aspect.
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 120;
const MAX_WIDTH = 2000;

// Parse + clamp a `?w=` query value to a safe render width. Pure, so the bounds
// are unit-testable and a hostile width can never blow up sharp.
export function clampThumbWidth(param: string | null | undefined): number {
  const w = Number.parseInt(param ?? "", 10);
  return Number.isFinite(w)
    ? Math.min(Math.max(w, MIN_WIDTH), MAX_WIDTH)
    : DEFAULT_WIDTH;
}

// Fetch the stored original and return a resized JPEG buffer. Re-encoding to
// JPEG (and converting HEIC/HEIF first, which sharp can't decode itself) makes
// every stored image display in every browser. Throws on a storage/sign/decode
// failure; the route maps that to a 5xx.
export async function renderImageThumbnail(
  storagePath: string,
  mime: string,
  width: number,
): Promise<Buffer> {
  const upstreamUrl = await signedUrl(storagePath, 120);
  const res = await fetch(upstreamUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("upstream_failed");
  const original = Buffer.from(await res.arrayBuffer());

  let input: Buffer = original;
  if (mime === "image/heic" || mime === "image/heif") {
    const jpeg = (await convert({
      buffer: original as unknown as ArrayBuffer,
      format: "JPEG",
      quality: 0.82,
    })) as ArrayBuffer;
    input = Buffer.from(jpeg);
  }

  return sharp(input)
    .rotate() // honour EXIF orientation (phone photos)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 76 })
    .toBuffer();
}
