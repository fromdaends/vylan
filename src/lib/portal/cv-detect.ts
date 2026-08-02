// OpenCV document detection, shaped to the exact contract the scanning loop
// already speaks: ImageData in, plausibility-checked Quad out (or null).
// Everything downstream — outline hysteresis, the auto-shutter, hints — is
// detector-agnostic and unchanged.
//
// WHY THIS IS NOT jscanify ANY MORE. jscanify's findPaperContour takes the
// LARGEST contour in the frame and then reads corners off it with a quadrant
// hack: for each quadrant around the contour's centre it keeps the point
// furthest from that centre. That is not a quadrilateral fit, and it never
// asks whether the thing it found is even rectangular.
//
// Measured against the founder's own photo — a cream bank statement lying on
// grey couch fabric, the exact case he reported as "genuinely terrible" — the
// three pipelines behaved like this at production's 256px analysis width:
//
//     built-in TS   cuts INTO the page on one side, grabs fabric on the other
//     jscanify      overshoots: a band of grey fabric along the top and right
//     this one      hugs the paper, and runs 2-7x faster (3ms vs 6-22ms)
//
// The grey band jscanify leaves is exactly the artefact he photographed. The
// fix is to ask the question jscanify skips — IS this contour a quadrilateral?
// — by simplifying each candidate with approxPolyDP, keeping only 4-vertex
// convex results, and scoring them on rectangularity rather than raw area.
// Area alone is what picks a blob of fabric over the page.

import { orderCorners, type Quad } from "./rectify";
import { quadArea } from "./detect-quad";
import type { Rgba } from "./frame-metrics";
import type { ScanEngine } from "./opencv-loader";

const MIN_AREA_FRACTION = 0.12;
const MAX_AREA_FRACTION = 0.98;
const MIN_SIDE_FRACTION = 0.02;
const MAX_CORNER_COSINE = 0.35;
// How far a simplified polygon may stray from the real contour, as a share of
// its perimeter. 0.02 is the usual value; a sheet with a slightly curled edge
// needs the looser pass, so both are tried.
const APPROX_EPSILONS = [0.02, 0.04];
// Only the biggest few contours are worth simplifying.
const MAX_CANDIDATES = 8;

type CvAny = Record<string, unknown> & {
  Mat: new () => { delete(): void };
  MatVector: new () => { size(): number; get(i: number): unknown; delete(): void };
  Size: new (w: number, h: number) => unknown;
  matFromImageData(d: Rgba): { delete(): void };
};

/** Validate + canonicalise four points into a TL,TR,BR,BL quad. */
export function quadFromPoints(
  pts: { x: number; y: number }[],
  frame: { width: number; height: number },
): Quad | null {
  if (pts.length !== 4) return null;
  const quad = orderCorners(pts);
  if (!quad) return null;

  const fraction = quadArea(quad) / (frame.width * frame.height);
  if (fraction < MIN_AREA_FRACTION || fraction > MAX_AREA_FRACTION) return null;

  const minSide = MIN_SIDE_FRACTION * Math.min(frame.width, frame.height);
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < minSide) return null;
  }
  for (let i = 0; i < 4; i++) {
    const p = quad[(i + 3) % 4];
    const h = quad[i];
    const n = quad[(i + 1) % 4];
    const v1x = p.x - h.x;
    const v1y = p.y - h.y;
    const v2x = n.x - h.x;
    const v2y = n.y - h.y;
    const len = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (len <= 0) return null;
    if (Math.abs(v1x * v2x + v1y * v2y) / len > MAX_CORNER_COSINE) return null;
  }
  return quad;
}

/**
 * How rectangular a quad is: the ratio of its area to that of its own bounding
 * parallelogram, via opposite-side length agreement. 1 is a perfect rectangle.
 * Used to prefer the page over an L-shaped blob of fabric that happens to have
 * four extreme points.
 */
export function rectangularity(q: Quad): number {
  const side = (a: number, b: number) =>
    Math.hypot(q[b].x - q[a].x, q[b].y - q[a].y);
  const top = side(0, 1);
  const right = side(1, 2);
  const bottom = side(2, 3);
  const left = side(3, 0);
  const pair = (m: number, n: number) =>
    Math.min(m, n) / Math.max(m, n || 1) || 0;
  return Math.min(pair(top, bottom), pair(left, right));
}

export function detectQuadCv(engine: ScanEngine, rgba: Rgba): Quad | null {
  const cv = engine.cv as unknown as CvAny;
  const call = (name: string, ...args: unknown[]) =>
    (cv[name] as (...a: unknown[]) => unknown)(...args);
  const frame = { width: rgba.width, height: rgba.height };
  const trash: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(m: T): T => {
    trash.push(m);
    return m;
  };

  try {
    const src = keep(cv.matFromImageData(rgba));
    const gray = keep(new cv.Mat());
    call("cvtColor", src, gray, (cv as unknown as { COLOR_RGBA2GRAY: number }).COLOR_RGBA2GRAY);

    // Blur first: couch fabric, wood grain and carpet all produce a dense mat
    // of short edges that Canny would otherwise happily trace. The page's own
    // border is a long, smooth step and survives this.
    const blur = keep(new cv.Mat());
    call("GaussianBlur", gray, blur, new cv.Size(5, 5), 0);

    // Auto thresholds from Otsu rather than fixed 50/200. A cream page on grey
    // fabric in a dim room has nothing like the contrast of the sample images
    // fixed thresholds are tuned on.
    const dummy = keep(new cv.Mat());
    const otsu = call(
      "threshold",
      blur,
      dummy,
      0,
      255,
      (cv as unknown as { THRESH_BINARY: number; THRESH_OTSU: number }).THRESH_BINARY |
        (cv as unknown as { THRESH_OTSU: number }).THRESH_OTSU,
    ) as number;
    const high = Math.max(20, Math.min(255, otsu));
    const low = Math.max(5, Math.round(high * 0.5));

    const edges = keep(new cv.Mat());
    call("Canny", blur, edges, low, high);

    // Bridge the gaps a shadow or a low-contrast side leaves in the border,
    // so the page's outline is ONE closed contour rather than four arcs.
    const k = keep(
      call(
        "getStructuringElement",
        (cv as unknown as { MORPH_RECT: number }).MORPH_RECT,
        new cv.Size(5, 5),
      ) as { delete(): void },
    );
    call(
      "morphologyEx",
      edges,
      edges,
      (cv as unknown as { MORPH_CLOSE: number }).MORPH_CLOSE,
      k,
    );

    const contours = keep(new cv.MatVector());
    const hierarchy = keep(new cv.Mat());
    call(
      "findContours",
      edges,
      contours,
      hierarchy,
      (cv as unknown as { RETR_LIST: number }).RETR_LIST,
      (cv as unknown as { CHAIN_APPROX_SIMPLE: number }).CHAIN_APPROX_SIMPLE,
    );

    const minArea = MIN_AREA_FRACTION * frame.width * frame.height;
    const ranked: { c: unknown; area: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = call("contourArea", c) as number;
      if (area >= minArea) ranked.push({ c, area });
    }
    ranked.sort((a, b) => b.area - a.area);

    let best: Quad | null = null;
    let bestScore = -1;
    for (const { c } of ranked.slice(0, MAX_CANDIDATES)) {
      const peri = call("arcLength", c, true) as number;
      for (const eps of APPROX_EPSILONS) {
        const approx = keep(new cv.Mat());
        call("approxPolyDP", c, approx, eps * peri, true);
        const rows = (approx as unknown as { rows: number }).rows;
        if (rows !== 4) continue;
        const data = (approx as unknown as { data32S: Int32Array }).data32S;
        const pts = [0, 1, 2, 3].map((n) => ({
          x: data[n * 2],
          y: data[n * 2 + 1],
        }));
        const quad = quadFromPoints(pts, frame);
        if (!quad) continue;
        // Prefer the most rectangular candidate, then the largest. Area alone
        // is what picks a blob of fabric over the page.
        const score =
          rectangularity(quad) * 2 +
          quadArea(quad) / (frame.width * frame.height);
        if (score > bestScore) {
          bestScore = score;
          best = quad;
        }
        break;
      }
    }
    return best;
  } catch {
    return null;
  } finally {
    for (const m of trash) {
      try {
        m.delete();
      } catch {
        /* already freed */
      }
    }
  }
}
