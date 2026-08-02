// jscanify/OpenCV document detection, shaped to the exact contract the
// scanning loop already speaks: ImageData in, plausibility-checked Quad out
// (or null). Everything downstream — outline hysteresis, the auto-shutter,
// hints — is detector-agnostic and stays untouched.
//
// jscanify's findPaperContour returns the LARGEST contour in the frame,
// unconditionally: point the camera at a table and it happily hands back the
// table. The custom detector (detect-quad.ts) earned a set of paper checks
// for exactly this class of false positive, so its acceptance rules are
// mirrored here on jscanify's corners — same constants, same reasoning —
// before anything is allowed to reach the shutter.

import { orderCorners, type Quad } from "./rectify";
import { quadArea } from "./detect-quad";
import type { Rgba } from "./frame-metrics";
import type { ScanEngine } from "./opencv-loader";
import type { JscanifyCornerPoints } from "jscanify/client";

/* Parity with detect-quad.ts's paper checks (kept private there; the values
 * matter more than the sharing — a quad both detectors would reject must not
 * pass just because OpenCV found it). */
// Ignore quads smaller than this fraction of the frame.
const MIN_AREA_FRACTION = 0.12;
// A quad this close to the whole frame is the frame itself, not paper.
const MAX_AREA_FRACTION = 0.98;
// Degenerate-sliver guard, as a fraction of the shorter frame side.
const MIN_SIDE_FRACTION = 0.02;
// Corners must be roughly right angles: |cos| <= 0.35 is ~70..110 degrees.
const MAX_CORNER_COSINE = 0.35;

/**
 * Validate jscanify's corner points and produce a canonical TL-TR-BR-BL Quad.
 * Pure — this is where the unit tests live.
 */
export function cornersToQuad(
  corners: JscanifyCornerPoints | null | undefined,
  frame: { width: number; height: number },
): Quad | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  const tl = corners?.topLeftCorner;
  const tr = corners?.topRightCorner;
  const bl = corners?.bottomLeftCorner;
  const br = corners?.bottomRightCorner;
  // A quadrant with no contour points yields a missing corner — half a
  // document at the frame edge, not a document we can flatten.
  if (!tl || !tr || !bl || !br) return null;

  // orderCorners also rejects non-finite and coincident points.
  const quad = orderCorners([tl, tr, br, bl]);
  if (!quad) return null;

  const frameArea = frame.width * frame.height;
  const fraction = quadArea(quad) / frameArea;
  if (fraction < MIN_AREA_FRACTION || fraction > MAX_AREA_FRACTION) return null;

  const minSide = MIN_SIDE_FRACTION * Math.min(frame.width, frame.height);
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < minSide) return null;
  }

  for (let i = 0; i < 4; i++) {
    const prev = quad[(i + 3) % 4];
    const here = quad[i];
    const next = quad[(i + 1) % 4];
    const v1x = prev.x - here.x;
    const v1y = prev.y - here.y;
    const v2x = next.x - here.x;
    const v2y = next.y - here.y;
    const len = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (len <= 0) return null;
    const cos = Math.abs(v1x * v2x + v1y * v2y) / len;
    if (cos > MAX_CORNER_COSINE) return null;
  }

  return quad;
}

/**
 * One detection pass over an analysis frame. Any OpenCV throw (a WASM heap
 * hiccup, a malformed frame) reads as "nothing found" — the loop runs 20x a
 * second and the fallback detector is one frame away, so a miss is always
 * cheaper than an exception escaping into the render loop.
 */
export function detectQuadCv(engine: ScanEngine, rgba: Rgba): Quad | null {
  let mat: { delete(): void } | null = null;
  let contour: { delete(): void } | null = null;
  try {
    mat = engine.cv.matFromImageData(rgba);
    contour = engine.scanner.findPaperContour(mat);
    if (!contour) return null;
    const corners = engine.scanner.getCornerPoints(contour, mat);
    return cornersToQuad(corners, { width: rgba.width, height: rgba.height });
  } catch {
    return null;
  } finally {
    // cv.Mat lives on the WASM heap; skipping delete() leaks ~350 KB per
    // analysed frame, which at 20 fps exhausts the heap in under a minute.
    try {
      contour?.delete?.();
    } catch {
      /* already freed */
    }
    try {
      mat?.delete?.();
    } catch {
      /* already freed */
    }
  }
}
