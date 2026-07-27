import type { Gray } from "./frame-metrics";
import type { Point, Quad } from "./rectify";

// Finds the four corners of a document in a downscaled camera frame so the UI
// can draw an outline over the paper and then flatten it. Pure functions over
// typed arrays only — this runs on every animation frame, and it must stay
// testable without a canvas.
//
// Pipeline: sobel -> adaptive threshold -> largest connected edge component ->
// convex hull -> decimate to a few vertices -> pick the max-area inscribed
// quadrilateral -> reject anything that doesn't look like paper.
//
// Why convex hull + max-area quad instead of the classic contour-trace +
// Douglas-Peucker: a thresholded Sobel map is thin and frequently BROKEN (a
// shadow or a low-contrast side leaves a gap). Boundary tracing wanders off
// down the wrong side of a broken stroke and the simplified polygon is then
// garbage. A hull degrades gracefully instead — if one side of the document is
// missing from the edge map entirely, the hull of the surviving three sides
// still spans the paper and the corners land close to the truth. The cost is
// that the hull is fooled by clutter *connected to* the document (a pen lying
// across the edge pulls a corner outward), which the support check below only
// partly mitigates.

export type DetectOptions = {
  /** Ignore quads smaller than this fraction of the frame. Default 0.12. */
  minAreaFraction?: number;
  /** Reject quads whose corners are too far from 90 degrees. Default: cos threshold 0.35 (~70..110 deg). */
  maxCornerCosine?: number;
};

/* ---------------------------------------------------------------- tuning ---
 * These are honest guesses tuned against synthetic frames, not against a real
 * camera. They are the first things to adjust if detection misbehaves on a
 * device.
 */

// Keep roughly the strongest 8% of pixels as edges. A document outline is ~2-3%
// of a frame, so this leaves headroom for texture without letting a whole noisy
// field through.
const EDGE_BUDGET_FRACTION = 0.08;
// ...but never budget fewer pixels than a full-frame outline would need, or a
// high-contrast document that fills a small frame would threshold away to
// nothing.
const EDGE_BUDGET_PERIMETER_MULTIPLE = 6;
// Below this Sobel magnitude we are looking at sensor noise, not a paper edge.
// A step of ~4 grey levels produces a magnitude of 16, so this is already close
// to the limit of what is detectable at all.
const MIN_EDGE_MAGNITUDE = 16;
// If this much of the frame survives thresholding there is no clean boundary in
// it (uniform noise, a smooth gradient, motion blur) — better to show nothing.
const MAX_EDGE_DENSITY = 0.35;
// A quad this close to the whole frame is the frame itself, not paper on a table.
const MAX_AREA_FRACTION = 0.98;
// Degenerate-sliver guard, as a fraction of the shorter frame side.
const MIN_SIDE_FRACTION = 0.02;
// The candidate's sides must actually sit on edge pixels of the same component.
// This is what separates a document from the convex hull of a random blob.
const SUPPORT_RADIUS = 2;
const MIN_TOTAL_SUPPORT = 0.55;
const MIN_SIDE_SUPPORT = 0.2;
// Vertex budget handed to the max-area-quad search (its cost is O(n^4)).
const MAX_POLY_VERTICES = 24;
// Hull vertices this close to the chord through their neighbours are
// rasterisation staircase, not corners.
const COLLINEAR_EPSILON = 1;
// Guard against pathological hulls before the O(n^2) decimation.
const MAX_HULL_VERTICES = 400;
// A frame smaller than this cannot hold a document outline worth tracing.
const MIN_FRAME_SIDE = 24;

/* ------------------------------------------------------------ public API --- */

/** Sobel magnitude map, same dimensions as input. Values clamped to 0..255. */
export function sobelMagnitude(gray: Gray): Gray {
  const w = Math.max(0, gray.width | 0);
  const h = Math.max(0, gray.height | 0);
  const n = w * h;
  const out = new Uint8ClampedArray(n);
  // A short buffer means the caller handed us a malformed frame; a flat map is
  // safer than reading undefined into NaN.
  if (n === 0 || gray.data.length < n) return { data: out, width: w, height: h };

  const src = gray.data;
  for (let y = 0; y < h; y++) {
    // Borders replicate the edge pixel, so a uniform frame yields zero
    // everywhere rather than a bright rectangle around the outside.
    const rowUp = clampInt(y - 1, 0, h - 1) * w;
    const rowMid = y * w;
    const rowDown = clampInt(y + 1, 0, h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xl = clampInt(x - 1, 0, w - 1);
      const xr = clampInt(x + 1, 0, w - 1);
      const tl = src[rowUp + xl];
      const tc = src[rowUp + x];
      const tr = src[rowUp + xr];
      const ml = src[rowMid + xl];
      const mr = src[rowMid + xr];
      const bl = src[rowDown + xl];
      const bc = src[rowDown + x];
      const br = src[rowDown + xr];
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      out[rowMid + x] = Math.min(255, Math.round(Math.sqrt(gx * gx + gy * gy)));
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Find the most likely document quad in a downscaled grayscale frame.
 * Returns null when nothing convincing is found — returning null is ALWAYS
 * better than returning a wrong quad, because a wrong quad makes the on-screen
 * outline jump around and destroys trust in the feature.
 */
export function detectQuad(gray: Gray, opts?: DetectOptions): Quad | null {
  const w = gray.width | 0;
  const h = gray.height | 0;
  const n = w * h;
  if (w < MIN_FRAME_SIDE || h < MIN_FRAME_SIDE || gray.data.length < n) {
    return null;
  }

  const minAreaFraction = clamp01(opts?.minAreaFraction ?? 0.12);
  const maxCornerCosine = clamp01(opts?.maxCornerCosine ?? 0.35);

  const mag = sobelMagnitude(gray);
  const threshold = edgeThreshold(mag);
  if (threshold === null) return null;

  const edge = new Uint8Array(n);
  let edgeCount = 0;
  for (let i = 0; i < n; i++) {
    if (mag.data[i] >= threshold) {
      edge[i] = 1;
      edgeCount++;
    }
  }
  // Nothing to trace, or so much of the frame is "edge" that no boundary can be
  // distinguished from the rest.
  if (edgeCount < 16 || edgeCount > MAX_EDGE_DENSITY * n) return null;

  const comp = largestComponent(edge, w, h);
  if (comp === null || comp.length < 16) return null;

  const mask = new Uint8Array(n);
  const pts: Point[] = new Array(comp.length);
  for (let i = 0; i < comp.length; i++) {
    const p = comp[i];
    mask[p] = 1;
    const x = p % w;
    pts[i] = { x, y: (p - x) / w };
  }

  let hull = convexHull(pts);
  if (hull.length < 4) return null;
  if (hull.length > MAX_HULL_VERTICES) hull = subsample(hull, MAX_HULL_VERTICES);

  const poly = decimate(hull, MAX_POLY_VERTICES, COLLINEAR_EPSILON);
  if (poly.length < 4) return null;

  const corners = maxAreaQuad(poly);
  if (corners === null) return null;

  const quad = orderQuadCorners(corners);
  if (quad === null) return null;

  const area = quadArea(quad);
  if (area < minAreaFraction * n || area > MAX_AREA_FRACTION * n) return null;
  if (!isConvex(quad)) return null;

  const minSide = MIN_SIDE_FRACTION * Math.min(w, h);
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < minSide) return null;
    // Corner i sits between edge (i-1 -> i) and edge (i -> i+1).
    const prev = quad[(i + 3) % 4];
    if (Math.abs(cornerCosine(prev, a, b)) > maxCornerCosine) return null;
  }

  if (!isSupported(quad, mask, w, h)) return null;

  return quad;
}

/** Map a quad from the downscaled detection space back to full-resolution pixels. */
export function scaleQuad(q: Quad, scaleX: number, scaleY: number): Quad {
  return [
    { x: q[0].x * scaleX, y: q[0].y * scaleY },
    { x: q[1].x * scaleX, y: q[1].y * scaleY },
    { x: q[2].x * scaleX, y: q[2].y * scaleY },
    { x: q[3].x * scaleX, y: q[3].y * scaleY },
  ];
}

/** Quad area via the shoelace formula (absolute value). */
export function quadArea(q: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Temporal smoothing so the outline glides instead of jittering.
 * Exponential moving average of corner positions: result = prev*(1-alpha) + next*alpha.
 * If prev is null, returns next unchanged. If the two quads are further apart
 * than `resetDistance` pixels at any corner, snap to `next` instead of easing
 * (the user moved to a different document — easing across that looks broken).
 */
export function smoothQuad(
  prev: Quad | null,
  next: Quad,
  alpha: number,
  resetDistance: number,
): Quad {
  if (prev === null) return next;
  for (let i = 0; i < 4; i++) {
    const dx = next[i].x - prev[i].x;
    const dy = next[i].y - prev[i].y;
    if (Math.hypot(dx, dy) > resetDistance) return next;
  }
  // Out-of-range alpha would overshoot the target and make the outline wobble.
  const a = clamp01(alpha);
  const ease = (i: number): Point => ({
    x: prev[i].x * (1 - a) + next[i].x * a,
    y: prev[i].y * (1 - a) + next[i].y * a,
  });
  return [ease(0), ease(1), ease(2), ease(3)];
}

/* -------------------------------------------------------------- internals --- */

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}

// Smallest threshold that keeps the edge pixel count inside the budget. Returns
// null when the frame has no gradient worth thresholding at all (flat field).
// The budget formulation is what makes this adaptive: a frame of uniform
// gradient magnitude (a smooth ramp) can never fit inside the budget, so the
// threshold walks past its single histogram bin and the edge map comes out
// empty — exactly the "no document here" answer we want.
function edgeThreshold(mag: Gray): number | null {
  const n = mag.width * mag.height;
  const hist = new Int32Array(256);
  let maxMag = 0;
  for (let i = 0; i < n; i++) {
    const v = mag.data[i];
    hist[v]++;
    if (v > maxMag) maxMag = v;
  }
  if (maxMag < MIN_EDGE_MAGNITUDE) return null;

  const budget = Math.max(
    Math.floor(n * EDGE_BUDGET_FRACTION),
    EDGE_BUDGET_PERIMETER_MULTIPLE * (mag.width + mag.height),
  );
  let count = 0;
  let t = 0;
  for (let v = 255; v >= 0; v--) {
    count += hist[v];
    if (count > budget) {
      t = v + 1;
      break;
    }
    t = v;
  }
  t = Math.max(t, MIN_EDGE_MAGNITUDE);
  // If the budget pushed us past the strongest pixel in the frame, fall back to
  // keeping only that strongest level rather than returning an empty map; the
  // density and shape checks downstream will throw it out if it is junk.
  return t > maxMag ? maxMag : t;
}

// Largest 8-connected component of the edge map, as pixel indices. Iterative
// flood fill — a recursive one blows the stack on a long document edge.
function largestComponent(
  edge: Uint8Array,
  w: number,
  h: number,
): number[] | null {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best: number[] | null = null;
  for (let start = 0; start < n; start++) {
    if (edge[start] === 0 || seen[start] === 1) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const comp: number[] = [];
    while (sp > 0) {
      const p = stack[--sp];
      comp.push(p);
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (edge[q] === 1 && seen[q] === 0) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    if (best === null || comp.length > best.length) best = comp;
  }
  return best;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Andrew's monotone chain. Output winds consistently; the caller normalises.
function convexHull(points: readonly Point[]): Point[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  const lower: Point[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function subsample(poly: readonly Point[], target: number): Point[] {
  const out: Point[] = [];
  const step = poly.length / target;
  for (let i = 0; i < target; i++) out.push(poly[Math.floor(i * step)]);
  return out;
}

// Perpendicular distance from p to the line through a and b.
function lineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
}

// Drop the vertex that matters least, repeatedly. On a convex polygon this is
// equivalent to Douglas-Peucker but targets a vertex COUNT directly, so there
// is no epsilon to binary-search: it stops as soon as the cheapest remaining
// vertex is a real corner rather than rasterisation staircase.
function decimate(
  poly: readonly Point[],
  maxVertices: number,
  collinearEps: number,
): Point[] {
  const out = poly.slice();
  while (out.length > 4) {
    let worstIdx = -1;
    let worstErr = Infinity;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const next = out[(i + 1) % out.length];
      const err = lineDistance(out[i], prev, next);
      if (err < worstErr) {
        worstErr = err;
        worstIdx = i;
      }
    }
    if (worstIdx < 0) break;
    if (out.length <= maxVertices && worstErr > collinearEps) break;
    out.splice(worstIdx, 1);
  }
  return out;
}

function triangleArea2(a: Point, b: Point, c: Point): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

// Largest-area quadrilateral inscribed in a convex polygon. For a rectangle (or
// a perspective-warped one) that is exactly its four corners, and unlike a
// simplification threshold it always returns four points or nothing.
function maxAreaQuad(poly: readonly Point[]): Point[] | null {
  const n = poly.length;
  if (n < 4) return null;
  if (n === 4) return poly.slice();
  let best: Point[] | null = null;
  let bestArea = 0;
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        const left = triangleArea2(poly[a], poly[b], poly[c]);
        for (let d = c + 1; d < n; d++) {
          const area = left + triangleArea2(poly[a], poly[c], poly[d]);
          if (area > bestArea) {
            bestArea = area;
            best = [poly[a], poly[b], poly[c], poly[d]];
          }
        }
      }
    }
  }
  return bestArea > 0 ? best : null;
}

// Put four corners into the fixed TL, TR, BR, BL order. Sorting by angle about
// the centroid (rather than by x+y / x-y extremes) keeps the order correct for
// quads with strong perspective, where two corners can share a "most top-left"
// score.
function orderQuadCorners(pts: readonly Point[]): Quad | null {
  if (pts.length !== 4) return null;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    cx += p.x / 4;
    cy += p.y / 4;
  }
  const byAngle = pts
    .slice()
    .sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  // Screen coordinates put y downward, so TL->TR->BR->BL has a positive
  // shoelace sum. Flip the winding if the sort produced the mirror.
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = byAngle[i];
    const b = byAngle[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  if (sum < 0) byAngle.reverse();
  let start = 0;
  for (let i = 1; i < 4; i++) {
    const s = byAngle[i].x + byAngle[i].y;
    if (s < byAngle[start].x + byAngle[start].y) start = i;
  }
  return [
    byAngle[start],
    byAngle[(start + 1) % 4],
    byAngle[(start + 2) % 4],
    byAngle[(start + 3) % 4],
  ];
}

function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const z = cross(a, b, c);
    if (z === 0) return false; // three corners in a line: not a document
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// Cosine of the angle at `corner` between the two sides meeting there.
function cornerCosine(prev: Point, corner: Point, next: Point): number {
  const ax = prev.x - corner.x;
  const ay = prev.y - corner.y;
  const bx = next.x - corner.x;
  const by = next.y - corner.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return 1;
  return (ax * bx + ay * by) / (la * lb);
}

function hasEdgeNear(mask: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  const x0 = clampInt(Math.round(x) - SUPPORT_RADIUS, 0, w - 1);
  const x1 = clampInt(Math.round(x) + SUPPORT_RADIUS, 0, w - 1);
  const y0 = clampInt(Math.round(y) - SUPPORT_RADIUS, 0, h - 1);
  const y1 = clampInt(Math.round(y) + SUPPORT_RADIUS, 0, h - 1);
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w;
    for (let xx = x0; xx <= x1; xx++) if (mask[row + xx] === 1) return true;
  }
  return false;
}

// Does each side of the candidate actually lie on edge pixels of the component
// it came from? A real document boundary is covered along all four sides; the
// convex hull of a sparse noise cluster is mostly empty space, which is what
// this rejects.
function isSupported(q: Quad, mask: Uint8Array, w: number, h: number): boolean {
  let hits = 0;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const samples = Math.max(8, Math.ceil(len / 2));
    let sideHits = 0;
    for (let s = 0; s < samples; s++) {
      const t = (s + 0.5) / samples;
      if (hasEdgeNear(mask, w, h, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) {
        sideHits++;
      }
    }
    if (sideHits / samples < MIN_SIDE_SUPPORT) return false;
    hits += sideHits;
    total += samples;
  }
  return total > 0 && hits / total >= MIN_TOTAL_SUPPORT;
}
