import type { Rgba } from "./frame-metrics";

// Perspective rectification: take the four corners of a document photographed
// at an angle and flatten it to a head-on rectangle, like a flatbed scan.
// Pure maths over plain typed arrays — no canvas, no DOM — so it is testable
// and reusable from a worker.

/**
 * A point in continuous image coordinates. (0,0) is the outer top-left corner
 * of the top-left pixel, so pixel (i,j) has its centre at (i+0.5, j+0.5).
 * Corner detectors work in this space, and it is what makes a full-frame quad
 * warp back to the identical image.
 */
export type Point = { x: number; y: number };

/** Corners in a FIXED order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

function isFinitePoint(p: Point | undefined): p is Point {
  return (
    !!p &&
    typeof p.x === "number" &&
    typeof p.y === "number" &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y)
  );
}

// Largest bounding-box side. All degeneracy thresholds are scaled by this so a
// 10px quad and a 4000px quad are judged the same way.
function spanOf(pts: readonly Point[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

/**
 * Four corners are unusable when any two coincide or any three are collinear:
 * both cases drop the rank of the 8x8 homography system, and solving anyway
 * yields plausible-looking garbage. Checked on the point SET, so the answer
 * does not depend on what order the corners arrived in.
 */
function isDegenerateCorners(pts: readonly Point[]): boolean {
  const span = spanOf(pts);
  if (!(span > 0)) return true; // every corner in the same place
  const minDist = 1e-6 * span;
  const minCross = 1e-9 * span * span;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      if (Math.hypot(dx, dy) < minDist) return true;
    }
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        const cross =
          (pts[j].x - pts[i].x) * (pts[k].y - pts[i].y) -
          (pts[j].y - pts[i].y) * (pts[k].x - pts[i].x);
        if (Math.abs(cross) < minCross) return true;
      }
    }
  }
  return false;
}

/**
 * Sort 4 arbitrary points into the canonical TL, TR, BR, BL order.
 * Returns null when there are not exactly 4 usable, non-degenerate points.
 *
 * Method: sort by the angle about the centroid, then rotate that cycle so the
 * corner with the smallest x+y leads. Angle-sorting is what makes this robust
 * to a rotated document — sorting by x then y swaps corners as soon as the
 * page tilts. Because image coordinates are y-down, ascending angle walks the
 * quad in TL -> TR -> BR -> BL order, so only the starting corner is in doubt.
 * The x+y pick holds until the page is rotated ~45 degrees, past which "which
 * corner is the top-left" is genuinely ambiguous anyway.
 */
export function orderCorners(pts: readonly Point[]): Quad | null {
  if (!Array.isArray(pts) || pts.length !== 4) return null;
  if (!pts.every(isFinitePoint)) return null;
  if (isDegenerateCorners(pts)) return null;

  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const cycle = pts
    .map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }))
    .sort((u, v) => u.a - v.a)
    .map((e) => e.p);

  let start = 0;
  for (let i = 1; i < 4; i++) {
    const p = cycle[i];
    const q = cycle[start];
    const sp = p.x + p.y;
    const sq = q.x + q.y;
    // Ties (an exactly 45-degree rotation) break toward the topmost, then
    // leftmost corner purely so the output stays deterministic.
    if (sp < sq || (sp === sq && (p.y < q.y || (p.y === q.y && p.x < q.x)))) {
      start = i;
    }
  }

  return [
    cycle[start],
    cycle[(start + 1) % 4],
    cycle[(start + 2) % 4],
    cycle[(start + 3) % 4],
  ] as Quad;
}

/**
 * Solve the 3x3 homography H (row-major, 9 numbers, normalised so h[8] === 1)
 * mapping each src corner onto the matching dst corner. Returns null when the
 * correspondence is degenerate (collinear or coincident points).
 *
 * Each correspondence (x,y) -> (u,v) contributes two rows to an 8x8 system:
 *   [x y 1 0 0 0 -ux -uy] . h = u
 *   [0 0 0 x y 1 -vx -vy] . h = v
 * solved by Gaussian elimination WITH PARTIAL PIVOTING. Pivoting is not
 * optional here: an axis-aligned quad (the common case — the destination
 * rectangle always starts at the origin) puts a zero in the first pivot slot,
 * and unpivoted elimination divides by it and returns silent garbage.
 */
export function solveHomography(src: Quad, dst: Quad): number[] | null {
  if (!Array.isArray(src) || !Array.isArray(dst)) return null;
  if (src.length !== 4 || dst.length !== 4) return null;
  if (!src.every(isFinitePoint) || !dst.every(isFinitePoint)) return null;
  if (isDegenerateCorners(src) || isDegenerateCorners(dst)) return null;

  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  let maxAbs = 1;
  for (const row of a) {
    for (const value of row) {
      const m = Math.abs(value);
      if (m > maxAbs) maxAbs = m;
    }
  }
  // Backstop for near-singular systems the geometric check above let through.
  const tol = 1e-9 * maxAbs;

  for (let col = 0; col < 8; col++) {
    let pivot = col;
    let bestAbs = Math.abs(a[col][col]);
    for (let r = col + 1; r < 8; r++) {
      const m = Math.abs(a[r][col]);
      if (m > bestAbs) {
        bestAbs = m;
        pivot = r;
      }
    }
    if (bestAbs <= tol) return null;
    if (pivot !== col) {
      const tmpRow = a[col];
      a[col] = a[pivot];
      a[pivot] = tmpRow;
      const tmpB = b[col];
      b[col] = b[pivot];
      b[pivot] = tmpB;
    }
    const d = a[col][col];
    for (let r = col + 1; r < 8; r++) {
      const f = a[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c < 8; c++) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }

  const h = new Array<number>(9).fill(0);
  for (let i = 7; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < 8; j++) s -= a[i][j] * h[j];
    h[i] = s / a[i][i];
  }
  h[8] = 1;
  if (!h.every((v) => Number.isFinite(v))) return null;
  return h;
}

/**
 * Apply H to a point, including the perspective divide. A point sitting on the
 * mapping's vanishing line has no finite image; the caller gets a non-finite
 * coordinate rather than a quietly wrong one.
 */
export function applyHomography(h: readonly number[], p: Point): Point {
  if (!h || h.length < 9 || !isFinitePoint(p)) return { x: NaN, y: NaN };
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

function edgeLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Output size for a rectified quad: the longer of the two horizontal edges by
 * the longer of the two vertical edges, so nothing in the document gets
 * squeezed. Rounded and clamped to at least 1x1. `maxDimension` (ignored
 * unless it is a finite number >= 1) caps the larger side, preserving aspect.
 */
export function outputSizeFor(
  quad: Quad,
  maxDimension?: number,
): { width: number; height: number } {
  if (!Array.isArray(quad) || quad.length !== 4 || !quad.every(isFinitePoint)) {
    return { width: 1, height: 1 };
  }
  const [tl, tr, br, bl] = quad;
  let w = Math.max(edgeLength(tl, tr), edgeLength(bl, br));
  let h = Math.max(edgeLength(tl, bl), edgeLength(tr, br));

  const cap =
    typeof maxDimension === "number" &&
    Number.isFinite(maxDimension) &&
    maxDimension >= 1
      ? maxDimension
      : null;
  if (cap !== null) {
    const longest = Math.max(w, h);
    if (longest > cap) {
      const scale = cap / longest;
      w *= scale;
      h *= scale;
    }
  }

  return {
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h)),
  };
}

function blankRgba(width: number, height: number): Rgba {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

/**
 * Warp the quad region of `src` into a head-on rectangle of size `out`.
 *
 * INVERSE mapping: we solve the homography from the destination rectangle to
 * the source quad and walk destination pixels, because forward-mapping source
 * pixels leaves unfilled holes wherever the warp stretches. Each destination
 * pixel centre is sampled BILINEARLY from the source; samples that fall
 * outside clamp to the edge pixel. If the quad is unusable the result is a
 * fully transparent buffer of the requested size rather than noise.
 */
export function warpToRect(
  src: Rgba,
  quad: Quad,
  out: { width: number; height: number },
): Rgba {
  const outW = Math.max(1, Math.floor(out?.width) || 0);
  const outH = Math.max(1, Math.floor(out?.height) || 0);
  const result = blankRgba(outW, outH);

  const sw = Math.floor(src?.width ?? 0);
  const sh = Math.floor(src?.height ?? 0);
  if (!(sw > 0) || !(sh > 0) || !src.data || src.data.length < sw * sh * 4) {
    return result;
  }
  if (!Array.isArray(quad) || quad.length !== 4 || !quad.every(isFinitePoint)) {
    return result;
  }

  const rect: Quad = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const h = solveHomography(rect, quad);
  if (!h) return result;

  const sdata = src.data;
  const ddata = result.data;
  const maxX = sw - 1;
  const maxY = sh - 1;

  for (let dy = 0; dy < outH; dy++) {
    const y = dy + 0.5;
    const nx = h[1] * y + h[2];
    const ny = h[4] * y + h[5];
    const nw = h[7] * y + h[8];
    for (let dx = 0; dx < outW; dx++) {
      const x = dx + 0.5;
      const w = h[6] * x + nw;
      const sx = (h[0] * x + nx) / w;
      const sy = (h[3] * x + ny) / w;
      const di = (dy * outW + dx) * 4;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue; // stays transparent

      // Pixel centres live at +0.5, so shift into "sample index" space before
      // splitting into integer cell + fraction.
      const gx = sx - 0.5;
      const gy = sy - 0.5;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const x0c = x0 < 0 ? 0 : x0 > maxX ? maxX : x0;
      const y0c = y0 < 0 ? 0 : y0 > maxY ? maxY : y0;
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const x1c = x1 < 0 ? 0 : x1 > maxX ? maxX : x1;
      const y1c = y1 < 0 ? 0 : y1 > maxY ? maxY : y1;

      const i00 = (y0c * sw + x0c) * 4;
      const i10 = (y0c * sw + x1c) * 4;
      const i01 = (y1c * sw + x0c) * 4;
      const i11 = (y1c * sw + x1c) * 4;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;

      for (let c = 0; c < 4; c++) {
        ddata[di + c] =
          sdata[i00 + c] * w00 +
          sdata[i10 + c] * w10 +
          sdata[i01 + c] * w01 +
          sdata[i11 + c] * w11;
      }
    }
  }

  return result;
}
