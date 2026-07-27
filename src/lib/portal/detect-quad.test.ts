import { describe, it, expect } from "vitest";
import type { Gray } from "./frame-metrics";
import type { Point, Quad } from "./rectify";
import {
  detectQuad,
  normaliseLocalContrast,
  quadArea,
  scaleQuad,
  smoothQuad,
  sobelMagnitude,
} from "./detect-quad";

/* --------------------------------------------------------------- helpers --- */

function makeGray(width: number, height: number, fill = 0): Gray {
  const data = new Uint8ClampedArray(width * height);
  if (fill !== 0) data.fill(fill);
  return { data, width, height };
}

/** Inclusive axis-aligned fill. */
function fillRect(
  g: Gray,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) g.data[y * g.width + x] = value;
  }
}

/**
 * Rasterise a filled rectangle rotated by `angle` (radians, positive = clockwise
 * on screen) about (cx, cy). Sample points are transformed into the rectangle's
 * own frame, which keeps the raster exactly consistent with `rotatedCorners`.
 */
function fillRotatedRect(
  g: Gray,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  angle: number,
  value: number,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (Math.abs(u) <= hw && Math.abs(v) <= hh) g.data[y * g.width + x] = value;
    }
  }
}

/**
 * Fill a convex polygon given in TL..BL winding order. Point-in-polygon by
 * consistent cross-product sign, which is exact for a convex outline and needs
 * no scanline bookkeeping.
 */
function fillConvexPolygon(g: Gray, pts: Point[], value: number): void {
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      let inside = true;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) {
          inside = false;
          break;
        }
      }
      if (inside) g.data[y * g.width + x] = value;
    }
  }
}

/** True corners of that rectangle, in TL, TR, BR, BL order. */
function rotatedCorners(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  angle: number,
): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(([u, v]) => ({
    x: cx + u * cos - v * sin,
    y: cy + u * sin + v * cos,
  }));
}

/**
 * A bright page on a dark table whose edges ramp over `blur` pixels either side
 * of the boundary, the way a real (slightly out-of-focus) camera frame looks.
 */
function softEdgedPage(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  blur: number,
): Gray {
  const g = makeGray(width, height, 30);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inset = Math.min(x - x0, x1 - x, y - y0, y1 - y);
      const t = Math.max(0, Math.min(1, (inset + blur) / (2 * blur)));
      g.data[y * width + x] = Math.round(30 + t * 200);
    }
  }
  return g;
}

/**
 * Deterministic, roughly gaussian per-pixel noise with unit standard deviation:
 * four hashed uniforms averaged, which by the central limit theorem is already
 * bell-shaped, then divided by the sd of that sum (sqrt(4/12) = 0.5774). No
 * Math.random, so a failure is always reproducible.
 */
function unitNoise(i: number, seed: number): number {
  let s = 0;
  for (let k = 0; k < 4; k++) {
    let x = (Math.imul(i + 1, 2654435761) ^ Math.imul(k + seed * 31 + 1, 40503)) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    s += (x >>> 8) / 16777216 - 0.5;
  }
  return s / 0.5774;
}

/** Add gaussian-ish sensor noise of the given standard deviation, in grey levels. */
function addNoise(g: Gray, sd: number, seed = 1): void {
  for (let i = 0; i < g.data.length; i++) {
    g.data[i] = Math.round(g.data[i] + unitNoise(i, seed) * sd);
  }
}

/**
 * 3x3 box blur, standing in for a real camera's edge: no phone photograph has a
 * one-pixel step in it, and a ramped edge halves the Sobel response, which is
 * exactly what makes the white-on-white case hard.
 */
function blur3(g: Gray): Gray {
  const { width: w, height: h } = g;
  const out = new Uint8ClampedArray(w * h);
  const cl = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          s += g.data[cl(y + dy, h - 1) * w + cl(x + dx, w - 1)];
        }
      }
      out[y * w + x] = Math.round(s / 9);
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * The hard case: a sheet of white paper on a light table. 160x120, surface at
 * luma 243, sheet `step` levels brighter, filling (30,20)..(129,99) — the same
 * rectangle the high-contrast tests use, so the two are directly comparable.
 */
function whiteOnWhite(step: number, noiseSd: number, blur: boolean, seed = 1): Gray {
  let g = makeGray(160, 120, 243);
  fillRect(g, 30, 20, 129, 99, 243 + step);
  if (blur) g = blur3(g);
  if (noiseSd > 0) addNoise(g, noiseSd, seed);
  return g;
}

/** Truth for whiteOnWhite, in TL, TR, BR, BL order. */
const PAGE_TRUTH: Point[] = [
  { x: 30, y: 20 },
  { x: 129, y: 20 },
  { x: 129, y: 99 },
  { x: 30, y: 99 },
];

/** Deterministic per-pixel noise — no Math.random, so failures are reproducible. */
function fillNoise(g: Gray): void {
  for (let i = 0; i < g.data.length; i++) {
    let x = (i * 2654435761) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    g.data[i] = x & 255;
  }
}

function quadOf(pts: Point[]): Quad {
  return [pts[0], pts[1], pts[2], pts[3]];
}

function expectCornersNear(actual: Quad, expected: Point[], tolerance: number): void {
  for (let i = 0; i < 4; i++) {
    expect(
      Math.hypot(actual[i].x - expected[i].x, actual[i].y - expected[i].y),
    ).toBeLessThanOrEqual(tolerance);
  }
}

/* ------------------------------------------------------------------ sobel --- */

describe("sobelMagnitude", () => {
  it("returns zero everywhere for a flat field (borders replicate)", () => {
    const flat = makeGray(8, 8, 200);
    const mag = sobelMagnitude(flat);
    expect(mag.width).toBe(8);
    expect(mag.height).toBe(8);
    expect(Array.from(mag.data).every((v) => v === 0)).toBe(true);
  });

  it("is zero for an all-black frame", () => {
    const mag = sobelMagnitude(makeGray(8, 8, 0));
    expect(Array.from(mag.data).every((v) => v === 0)).toBe(true);
  });

  it("gives exactly 4x the step for a vertical edge", () => {
    // Left half 0, right half 10. Sobel gx = 4 * 10 = 40 on both sides of the step.
    const g = makeGray(8, 8, 0);
    fillRect(g, 4, 0, 7, 7, 10);
    const mag = sobelMagnitude(g);
    const row = 4 * 8;
    expect(mag.data[row + 3]).toBe(40);
    expect(mag.data[row + 4]).toBe(40);
    expect(mag.data[row + 1]).toBe(0);
    expect(mag.data[row + 6]).toBe(0);
  });

  it("gives exactly 4x the step for a horizontal edge", () => {
    const g = makeGray(8, 8, 0);
    fillRect(g, 0, 4, 7, 7, 10);
    const mag = sobelMagnitude(g);
    expect(mag.data[3 * 8 + 4]).toBe(40);
    expect(mag.data[4 * 8 + 4]).toBe(40);
    expect(mag.data[1 * 8 + 4]).toBe(0);
    expect(mag.data[6 * 8 + 4]).toBe(0);
  });

  it("replicates the border rather than wrapping it", () => {
    // The outermost row/column has no real neighbour on one side. Replicating
    // the edge pixel makes those rows read as flat; wrapping to the opposite
    // side of the frame would instead paint a phantom rectangle around the
    // whole picture, and that phantom is a big connected component the
    // detector would happily hull. The flat-field tests above cannot see the
    // difference, because wrapping a uniform frame still reads the same value.
    const g = makeGray(8, 8, 0);
    fillRect(g, 0, 4, 7, 7, 10); // dark top half, bright bottom half
    const mag = sobelMagnitude(g);
    expect(mag.data[0 * 8 + 4]).toBe(0); // top row: no edge from the bottom row
    expect(mag.data[7 * 8 + 4]).toBe(0); // bottom row: no edge from the top row

    const v = makeGray(8, 8, 0);
    fillRect(v, 4, 0, 7, 7, 10); // dark left half, bright right half
    const vmag = sobelMagnitude(v);
    expect(vmag.data[4 * 8 + 0]).toBe(0); // left column
    expect(vmag.data[4 * 8 + 7]).toBe(0); // right column
  });

  it("clamps a full-range step to 255", () => {
    const g = makeGray(8, 8, 0);
    fillRect(g, 4, 0, 7, 7, 255);
    const mag = sobelMagnitude(g);
    expect(mag.data[4 * 8 + 3]).toBe(255);
  });

  it("handles 1x1 and 0x0 buffers", () => {
    const one = sobelMagnitude(makeGray(1, 1, 123));
    expect(one.data.length).toBe(1);
    expect(one.data[0]).toBe(0);
    const none = sobelMagnitude({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
    expect(none.data.length).toBe(0);
  });
});

/* -------------------------------------------------------------- quadArea --- */

describe("quadArea", () => {
  it("gives 1 for the unit square", () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(quadArea(q)).toBe(1);
  });

  it("is orientation independent", () => {
    const cw: Quad = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    const ccw: Quad = [cw[3], cw[2], cw[1], cw[0]];
    expect(quadArea(cw)).toBe(12);
    expect(quadArea(ccw)).toBe(12);
  });

  it("handles a trapezoid", () => {
    // Parallel sides 4 and 8, height 2 -> area 12.
    const q: Quad = [
      { x: 2, y: 0 },
      { x: 6, y: 0 },
      { x: 8, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(quadArea(q)).toBe(12);
  });

  it("is 0 for a fully degenerate (collinear) quad", () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(quadArea(q)).toBe(0);
  });
});

/* ------------------------------------------------------------- scaleQuad --- */

describe("scaleQuad", () => {
  it("scales each corner and preserves order", () => {
    const q: Quad = [
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 5 },
      { x: 1, y: 5 },
    ];
    const s = scaleQuad(q, 4, 0.5);
    expect(s).toEqual([
      { x: 4, y: 1 },
      { x: 12, y: 1 },
      { x: 12, y: 2.5 },
      { x: 4, y: 2.5 },
    ]);
    // area scales by scaleX * scaleY
    expect(quadArea(s)).toBeCloseTo(quadArea(q) * 4 * 0.5, 10);
  });

  it("does not mutate the input", () => {
    const q: Quad = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ];
    scaleQuad(q, 10, 10);
    expect(q[0]).toEqual({ x: 1, y: 1 });
  });
});

/* ------------------------------------------------------------ smoothQuad --- */

describe("smoothQuad", () => {
  const prev: Quad = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("returns next unchanged when there is no previous quad", () => {
    const next: Quad = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ];
    expect(smoothQuad(null, next, 0.5, 100)).toBe(next);
  });

  it("eases each corner by alpha", () => {
    const next: Quad = [
      { x: 4, y: 4 },
      { x: 14, y: 0 },
      { x: 10, y: 14 },
      { x: -4, y: 10 },
    ];
    const out = smoothQuad(prev, next, 0.25, 100);
    expect(out[0]).toEqual({ x: 1, y: 1 });
    expect(out[1]).toEqual({ x: 11, y: 0 });
    expect(out[2]).toEqual({ x: 10, y: 11 });
    expect(out[3]).toEqual({ x: -1, y: 10 });
  });

  it("alpha 0 holds prev and alpha 1 jumps to next", () => {
    const next: Quad = [
      { x: 2, y: 2 },
      { x: 12, y: 2 },
      { x: 12, y: 12 },
      { x: 2, y: 12 },
    ];
    expect(smoothQuad(prev, next, 0, 100)).toEqual(prev);
    expect(smoothQuad(prev, next, 1, 100)).toEqual(next);
  });

  it("snaps to next when any single corner jumps past resetDistance", () => {
    const next: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 40 }, // moved 30px
    ];
    expect(smoothQuad(prev, next, 0.25, 20)).toBe(next);
  });

  it("still eases when the move is exactly resetDistance", () => {
    const next: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 30 }, // moved exactly 20px
    ];
    const out = smoothQuad(prev, next, 0.5, 20);
    expect(out[3]).toEqual({ x: 0, y: 20 });
  });

  it("measures the reset distance diagonally, not per axis", () => {
    // 3-4-5 triangle: each axis moves under 20 but the corner moves 25.
    const next: Quad = [
      { x: 15, y: 20 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(smoothQuad(prev, next, 0.5, 20)).toBe(next);
  });

  it("clamps an out-of-range alpha so the outline cannot overshoot", () => {
    const next: Quad = [
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const out = smoothQuad(prev, next, 3, 100);
    expect(out[0]).toEqual({ x: 10, y: 0 });
  });
});

/* ------------------------------------------------------------ detectQuad --- */

describe("detectQuad", () => {
  it("finds a bright axis-aligned page on a dark table", () => {
    const g = makeGray(160, 120, 20);
    fillRect(g, 30, 20, 129, 99, 230);
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(
      q as Quad,
      [
        { x: 30, y: 20 },
        { x: 129, y: 20 },
        { x: 129, y: 99 },
        { x: 30, y: 99 },
      ],
      2.5,
    );
    // Corner order must be TL, TR, BR, BL.
    const quad = q as Quad;
    expect(quad[0].x).toBeLessThan(quad[1].x);
    expect(quad[0].y).toBeLessThan(quad[3].y);
    expect(quadArea(quad)).toBeGreaterThan(7000);
  });

  it("finds a dark page on a bright table (edge polarity does not matter)", () => {
    const g = makeGray(160, 120, 235);
    fillRect(g, 30, 20, 129, 99, 25);
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(
      q as Quad,
      [
        { x: 30, y: 20 },
        { x: 129, y: 20 },
        { x: 129, y: 99 },
        { x: 30, y: 99 },
      ],
      2.5,
    );
  });

  it("finds a page rotated by 12 degrees", () => {
    const angle = (12 * Math.PI) / 180;
    const g = makeGray(200, 200, 30);
    fillRotatedRect(g, 100, 100, 60, 45, angle, 220);
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(q as Quad, rotatedCorners(100, 100, 60, 45, angle), 3);
  });

  it("finds a page rotated the other way", () => {
    const angle = (-14 * Math.PI) / 180;
    const g = makeGray(200, 200, 210);
    fillRotatedRect(g, 100, 100, 62, 44, angle, 40);
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(q as Quad, rotatedCorners(100, 100, 62, 44, angle), 3);
  });

  it("finds a page seen at an angle (trapezoid, mild perspective)", () => {
    // Top edge 60px wide, bottom edge 100px wide, 80 rows tall.
    const g = makeGray(160, 120, 25);
    const top = 20;
    const rows = 80;
    for (let i = 0; i <= rows; i++) {
      const halfWidth = 30 + (20 * i) / rows;
      const y = top + i;
      fillRect(g, Math.round(80 - halfWidth), y, Math.round(80 + halfWidth), y, 225);
    }
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(
      q as Quad,
      [
        { x: 50, y: 20 },
        { x: 110, y: 20 },
        { x: 130, y: 100 },
        { x: 30, y: 100 },
      ],
      3.5,
    );
  });

  it("finds a page with soft, out-of-focus edges", () => {
    // Real camera edges ramp over a few pixels rather than stepping. The Sobel
    // ring is then wider and weaker than the synthetic step cases above.
    const g = softEdgedPage(160, 120, 30, 20, 129, 99, 2);
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(
      q as Quad,
      [
        { x: 30, y: 20 },
        { x: 129, y: 20 },
        { x: 129, y: 99 },
        { x: 30, y: 99 },
      ],
      3,
    );
  });

  it("finds a page that nearly fills a very small detection frame", () => {
    // 48x36 is an aggressive downscale: the page outline is a far larger share
    // of the frame than the percentile edge budget alone would allow, so the
    // budget has to scale with the frame perimeter or the outline thresholds
    // away to nothing.
    const g = softEdgedPage(48, 36, 6, 4, 42, 32, 2);
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(
      q as Quad,
      [
        { x: 6, y: 4 },
        { x: 42, y: 4 },
        { x: 42, y: 32 },
        { x: 6, y: 32 },
      ],
      2.5,
    );
  });

  it("returns null for uniform noise", () => {
    const g = makeGray(160, 120);
    fillNoise(g);
    expect(detectQuad(g)).toBeNull();
  });

  it("returns null for a smooth gradient", () => {
    const g = makeGray(160, 120);
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 160; x++) g.data[y * 160 + x] = Math.round(x * 1.5);
    }
    expect(detectQuad(g)).toBeNull();
  });

  it("returns null for an empty frame", () => {
    expect(detectQuad(makeGray(160, 120, 0))).toBeNull();
    expect(detectQuad(makeGray(160, 120, 255))).toBeNull();
  });

  it("returns null when the page is smaller than minAreaFraction", () => {
    const g = makeGray(160, 120, 20);
    // 40x30 = 1200 px of a 19200 px frame = 6.25%.
    fillRect(g, 40, 40, 79, 69, 230);
    expect(detectQuad(g)).toBeNull();
    // Same frame, lower bar -> found. Proves the rejection was the area rule
    // and not a failure to see the rectangle at all.
    const relaxed = detectQuad(g, { minAreaFraction: 0.03 });
    expect(relaxed).not.toBeNull();
    expectCornersNear(
      relaxed as Quad,
      [
        { x: 40, y: 40 },
        { x: 79, y: 40 },
        { x: 79, y: 69 },
        { x: 40, y: 69 },
      ],
      2.5,
    );
  });

  it("rejects a 45-degree parallelogram but accepts it once the corner rule is relaxed", () => {
    const g = makeGray(200, 160, 25);
    for (let i = 0; i <= 70; i++) {
      const y = 30 + i;
      fillRect(g, 20 + i, y, 100 + i, y, 225);
    }
    expect(detectQuad(g)).toBeNull();
    expect(detectQuad(g, { maxCornerCosine: 0.85 })).not.toBeNull();
  });

  it("rejects a quad whose only bad corner is too OBTUSE", () => {
    // The corner rule compares |cos|, and the abs is load-bearing: without it
    // only over-acute corners are caught, because an over-obtuse corner has a
    // NEGATIVE cosine. The 45-degree parallelogram above cannot show this — it
    // has acute corners too, so it is rejected either way.
    //
    // Interior angles here are 120, 80, 80, 80 (they sum to 360, so this is a
    // realisable convex quad). Only the 120-degree corner is out of range, and
    // its cosine is -0.5, i.e. invisible to an unsigned comparison. Built from
    // exterior turns of 60, 100, 100, 100 degrees with the sides solved for
    // closure, then shifted into the frame.
    const corners: Point[] = [
      { x: 50, y: 25 },
      { x: 124.23, y: 25 },
      { x: 106.87, y: 123.48 },
      { x: 12.9, y: 89.28 },
    ];
    const g = makeGray(200, 160, 25);
    fillConvexPolygon(g, corners, 225);

    expect(detectQuad(g)).toBeNull();
    // Relaxing past |cos 120| = 0.5 finds it, which proves the rejection was
    // the corner rule and not a failure to see the shape at all.
    const relaxed = detectQuad(g, { maxCornerCosine: 0.6 });
    expect(relaxed).not.toBeNull();
    expectCornersNear(relaxed as Quad, corners, 2.5);
  });

  it("returns null for frames too small to hold a document", () => {
    expect(detectQuad({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull();
    expect(detectQuad(makeGray(1, 1, 255))).toBeNull();
    expect(detectQuad(makeGray(8, 8, 0))).toBeNull();
    // Even a picture-perfect rectangle is refused below the minimum frame size:
    // at 16px across, one pixel of corner error is 6% of the page.
    const tiny = makeGray(16, 16, 20);
    fillRect(tiny, 3, 3, 12, 12, 230);
    expect(detectQuad(tiny)).toBeNull();
  });

  it("returns null when the page bleeds past the edge of the frame", () => {
    // Its corners are outside the picture, so any outline we drew would be
    // pinned to the frame border rather than to the paper.
    const g = makeGray(160, 120, 20);
    fillRect(g, 1, 1, 158, 118, 230);
    expect(detectQuad(g)).toBeNull();
  });

  it("returns null when the buffer is shorter than width * height", () => {
    const short: Gray = { data: new Uint8ClampedArray(100), width: 160, height: 120 };
    expect(detectQuad(short)).toBeNull();
  });

  it("survives a low-contrast page (10 grey levels of separation)", () => {
    const g = makeGray(160, 120, 200);
    fillRect(g, 30, 20, 129, 99, 210);
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(
      q as Quad,
      [
        { x: 30, y: 20 },
        { x: 129, y: 20 },
        { x: 129, y: 99 },
        { x: 30, y: 99 },
      ],
      2.5,
    );
  });

  // CHANGED EXPECTATION. This test used to assert that a 2-grey-level page
  // returns null, on the reasoning that "below ~4 levels the Sobel response is
  // indistinguishable from sensor noise". The local contrast pass makes that
  // false for THIS fixture, and the old reasoning does not survive contact with
  // it: the fixture has no sensor noise at all — a hard 2-level step on a
  // perfectly flat surface. Nothing about it is indistinguishable from noise
  // that is not there, and the normalising pass now recovers it to within 3px.
  //
  // What the original test was really protecting is preserved directly below:
  // once the fixture carries the sensor noise its comment appeals to, the
  // answer goes back to null. The claim has changed from "2 levels is
  // impossible" to the true and narrower "2 levels under noise is impossible".
  it("now recovers a 2-grey-level page when the frame is genuinely noiseless", () => {
    const g = makeGray(160, 120, 200);
    fillRect(g, 30, 20, 129, 99, 202);
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(q as Quad, PAGE_TRUTH, 3);
  });

  it("still gives up on a 2-grey-level page once the frame carries sensor noise", () => {
    // Two levels of separation under two levels of noise is a step buried in
    // its own noise floor. No amount of normalisation invents information that
    // is not in the frame, and guessing here would put a jittering outline over
    // nothing.
    for (const seed of [1, 2, 3]) {
      const g = makeGray(160, 120, 200);
      fillRect(g, 30, 20, 129, 99, 202);
      addNoise(g, 2, seed);
      expect(detectQuad(g)).toBeNull();
    }
  });

  it("returns null for a large densely textured patch (a placemat, not a page)", () => {
    // 3px tiled checkerboard. Its edge map is a dense connected mesh whose hull
    // is a convincing page-shaped rectangle with near-perfect support, so every
    // other check passes it — only the edge-density guard rejects it.
    const g = makeGray(160, 120, 20);
    for (let y = 15; y < 110; y++) {
      for (let x = 15; x < 145; x++) {
        const tile = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0;
        g.data[y * 160 + x] = tile ? 230 : 20;
      }
    }
    expect(detectQuad(g)).toBeNull();
  });

  it("returns null when one whole side of the page has no contrast", () => {
    // The page fades into the table on the right, so that edge produces no
    // gradient at all. The hull still spans about the right shape, but the right
    // side of the candidate rests on nothing, which makes those two corners
    // guesses — better to show no outline than one with an invented edge.
    const g = makeGray(160, 120, 20);
    for (let y = 20; y <= 99; y++) {
      for (let x = 30; x <= 129; x++) {
        // Full contrast on the left, fading to the table value by the right edge.
        const t = Math.max(0, Math.min(1, (110 - x) / 40));
        g.data[y * 160 + x] = Math.round(20 + t * 210);
      }
    }
    expect(detectQuad(g)).toBeNull();
  });

  it("returns null for a large round object (a plate, not a page)", () => {
    // The max-area quad inscribed in a circle is a square with 90-degree
    // corners and plenty of area, so only the edge-support check can reject it:
    // the square's sides cut across empty space instead of following the rim.
    const g = makeGray(160, 120, 20);
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 160; x++) {
        if (Math.hypot(x - 80, y - 60) <= 50) g.data[y * 160 + x] = 230;
      }
    }
    expect(detectQuad(g)).toBeNull();
  });

  it("ignores clutter that is smaller than the page", () => {
    const g = makeGray(200, 160, 20);
    // The clutter is drawn ABOVE the page on purpose: raster scan order reaches
    // it first, so passing this requires actually comparing component sizes
    // rather than keeping whichever component turns up first.
    fillRect(g, 5, 5, 25, 20, 200); // a small bright object near the top-left
    fillRect(g, 40, 30, 149, 119, 230); // the page
    const q = detectQuad(g);
    expect(q).not.toBeNull();
    expectCornersNear(
      q as Quad,
      [
        { x: 40, y: 30 },
        { x: 149, y: 30 },
        { x: 149, y: 119 },
        { x: 40, y: 119 },
      ],
      2.5,
    );
  });

  it("output feeds scaleQuad and quadArea consistently", () => {
    const g = makeGray(160, 120, 20);
    fillRect(g, 30, 20, 129, 99, 230);
    const q = detectQuad(g) as Quad;
    const full = scaleQuad(q, 4, 4);
    expect(quadArea(full)).toBeCloseTo(quadArea(q) * 16, 6);
    expect(full[0].x).toBeCloseTo(q[0].x * 4, 10);
  });

  it("is deterministic across repeated calls", () => {
    const g = makeGray(160, 120, 20);
    fillRect(g, 30, 20, 129, 99, 230);
    const a = detectQuad(g) as Quad;
    const b = detectQuad(g) as Quad;
    expect(quadOf(a as unknown as Point[])).toEqual(b);
  });
});


/* --------------------------------------------- normaliseLocalContrast --- */

describe("normaliseLocalContrast", () => {
  it("maps any flat field to a flat 128", () => {
    // Every pixel equals its own neighbourhood mean, so the numerator is 0 and
    // the divisor floor never matters. 128 rather than 0 because the output is
    // unsigned and an edge has a dark side as well as a bright one.
    for (const level of [0, 30, 128, 243, 255]) {
      const out = normaliseLocalContrast(makeGray(64, 48, level));
      expect(Array.from(out.data).every((v) => v === 128)).toBe(true);
    }
  });

  it("preserves dimensions and does not mutate the input", () => {
    const g = makeGray(70, 50, 200);
    fillRect(g, 10, 10, 40, 30, 210);
    const before = Array.from(g.data);
    const out = normaliseLocalContrast(g);
    expect(out.width).toBe(70);
    expect(out.height).toBe(50);
    expect(out.data.length).toBe(70 * 50);
    expect(Array.from(g.data)).toEqual(before);
  });

  it("is deterministic", () => {
    const g = whiteOnWhite(7, 2, true);
    expect(Array.from(normaliseLocalContrast(g).data)).toEqual(
      Array.from(normaliseLocalContrast(g).data),
    );
  });

  it("returns a flat map for malformed frames instead of NaN", () => {
    const short = normaliseLocalContrast({
      data: new Uint8ClampedArray(10),
      width: 64,
      height: 48,
    });
    expect(short.data.length).toBe(64 * 48);
    expect(Array.from(short.data).every((v) => v === 0)).toBe(true);
    const empty = normaliseLocalContrast({
      data: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
    });
    expect(empty.data.length).toBe(0);
  });

  it("flattens a linear ramp to exactly 128 in the interior", () => {
    // Analytic: the box mean of a linear ramp equals the ramp's value at the
    // window centre, so numerator = centre - mean = 0 EXACTLY, whatever the
    // slope and whatever the divisor. This is the property that makes the pass
    // safe against a lighting gradient across the table, and it is exact rather
    // than approximate, so an off-by-one in the summed-area indexing would
    // break it loudly. Only the interior: windows are clipped at the border, so
    // there the mean is no longer centred on the pixel.
    const g = makeGray(160, 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) g.data[y * 160 + x] = x;
    const out = normaliseLocalContrast(g);
    const margin = Math.round((120 * 0.25) / 2) + 2;
    for (let y = margin; y < 120 - margin; y++) {
      for (let x = margin; x < 160 - margin; x++) {
        expect(out.data[y * 160 + x]).toBe(128);
      }
    }
  });

  it("amplifies a 7-level step to about 36 levels, close to the gain cap", () => {
    // The whole point of the exercise, with a number to check it against. A
    // window straddling this boundary is half at 243 and half at 250, so its
    // spread is ~3.5 — under the floor of 8, so the gain saturates at
    // TARGET/FLOOR = 48/8 = 6x and the ideal amplified step is 7 * 6 = 42. The
    // 5x5 pre-smooth spreads the step over a few pixels and gives back some of
    // that, so the measured jump is 36: 5.1x the raw step, and 86% of the
    // theoretical ceiling. Anything below 30 would mean the gain is not
    // reaching the boundary.
    const g = makeGray(160, 120, 243);
    fillRect(g, 80, 0, 159, 119, 250);
    const out = normaliseLocalContrast(g);
    const row = 60 * 160;
    let lo = 255;
    let hi = 0;
    for (let x = 0; x < 160; x++) {
      lo = Math.min(lo, out.data[row + x]);
      hi = Math.max(hi, out.data[row + x]);
    }
    expect(hi - lo).toBeGreaterThanOrEqual(30);
    // The jump happens AT the boundary, not somewhere else in the row.
    expect(out.data[row + 82] - out.data[row + 77]).toBeGreaterThanOrEqual(30);
    // Polarity is not inverted, and far from the boundary it settles back to
    // the neutral 128 rather than staying pushed.
    expect(out.data[row + 85]).toBeGreaterThan(128);
    expect(out.data[row + 74]).toBeLessThan(128);
    expect(out.data[row + 20]).toBe(128);
    expect(out.data[row + 140]).toBe(128);
  });

  it("caps the gain in a flat noisy region instead of amplifying to full contrast", () => {
    // The trap this pass is most likely to fall into: local spread in a blank
    // region IS the sensor noise, so dividing by it rescales noise to full
    // contrast and manufactures a field of edges. Floored, the gain saturates
    // at TARGET/FLOOR = 48/8 = 6x, and the 5x5 pre-smooth cuts the noise that
    // reaches the numerator further still.
    const g = makeGray(160, 120, 200);
    addNoise(g, 2, 5);
    const out = normaliseLocalContrast(g);
    let peak = 0;
    for (const v of out.data) peak = Math.max(peak, Math.abs(v - 128));
    // Unfloored, a ±6 level noise field would be stretched to the full ±127.
    expect(peak).toBeLessThan(40);
    // Sanity: it did not simply return a constant either.
    expect(peak).toBeGreaterThan(0);
  });

  it("honours windowFraction: a window as wide as the frame keeps a global ramp", () => {
    // With a small window the local mean tracks the ramp and cancels it (the
    // test above). With a window covering the whole frame the mean is the global
    // mean, so the ramp survives — which is the same code path proving the
    // parameter actually reaches the window size.
    const g = makeGray(160, 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) g.data[y * 160 + x] = x;
    const wide = normaliseLocalContrast(g, 1);
    expect(wide.data[60 * 160 + 10]).toBeLessThan(100);
    expect(wide.data[60 * 160 + 150]).toBeGreaterThan(156);
    const narrow = normaliseLocalContrast(g, 0.125);
    expect(narrow.data[60 * 160 + 10]).toBe(128);
    expect(narrow.data[60 * 160 + 150]).toBe(128);
  });

  it("clamps a nonsense windowFraction instead of dividing by zero", () => {
    for (const wf of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      const out = normaliseLocalContrast(makeGray(64, 48, 100), wf);
      expect(Array.from(out.data).every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it("costs O(1) per pixel: a 640x480 frame normalises well inside the frame budget", () => {
    // The integral-image claim, measured rather than asserted. A naive per-pixel
    // window loop at this size is a 60px window over 307200 pixels — about 1.1e9
    // reads, which is seconds, not milliseconds.
    const g = makeGray(640, 480, 243);
    fillRect(g, 120, 90, 519, 389, 250);
    addNoise(g, 2, 3);
    normaliseLocalContrast(g); // warm up the JIT
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      normaliseLocalContrast(g);
      best = Math.min(best, performance.now() - t0);
    }
    console.log(`normaliseLocalContrast 640x480: ${best.toFixed(1)}ms`);
    expect(best).toBeLessThan(100);
  });

  it("scales linearly-ish with pixel count, not with window area", () => {
    // The sharper version of the same claim: doubling the frame's smaller side
    // quadruples the pixel count AND quadruples the window area. Under an O(1)
    // window the cost goes up ~4x; under a naive window it would go up ~16x.
    const small = makeGray(320, 240, 243);
    fillRect(small, 60, 45, 259, 194, 250);
    const large = makeGray(640, 480, 243);
    fillRect(large, 120, 90, 519, 389, 250);
    const time = (g: Gray): number => {
      normaliseLocalContrast(g);
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        normaliseLocalContrast(g);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const ratio = time(large) / Math.max(time(small), 0.05);
    console.log(`640x480 / 320x240 cost ratio: ${ratio.toFixed(1)}x (O(1) window ~4x)`);
    expect(ratio).toBeLessThan(10);
  });
});

/* ------------------------------------------ detectQuad on faint frames --- */

describe("detectQuad on a white page on a light table", () => {
  it("finds a 7-level page under light sensor noise (the case that used to fail)", () => {
    // White paper at luma 250 on a table at 243, camera-soft edges, noise sd 2.
    // Before the local contrast pass this returned null: the raw Sobel response
    // of a 7-level ramped step is ~13, and in a frame this noisy more than the
    // whole edge budget of pixels beats 13 on noise alone, so the boundary was
    // thresholded away entirely.
    for (const seed of [1, 2, 3]) {
      const g = whiteOnWhite(7, 2, true, seed);
      const q = detectQuad(g);
      expect(q).not.toBeNull();
      expectCornersNear(q as Quad, PAGE_TRUTH, 5);
    }
  });

  it("finds the same page with a hard edge and heavier noise", () => {
    for (const seed of [1, 2, 3]) {
      const q = detectQuad(whiteOnWhite(7, 3, false, seed));
      expect(q).not.toBeNull();
      expectCornersNear(q as Quad, PAGE_TRUTH, 8);
    }
  });

  it("pushes to a 4-level step, which works up to about 2 levels of noise", () => {
    // Honest boundary, measured across seeds rather than tuned to one fixture.
    // 4 levels is half the step of the case above and right at the limit: with
    // noise sd 1 it is found every time, at sd 2 most of the time, and by sd 3
    // it is gone. Nothing here special-cases the fixture — the same code and
    // the same constants produce the whole grid.
    for (const seed of [1, 2, 3]) {
      const q = detectQuad(whiteOnWhite(4, 1, true, seed));
      expect(q).not.toBeNull();
      expectCornersNear(q as Quad, PAGE_TRUTH, 5);
    }
    // At sd 2 it is a coin flip, and this is reported rather than dressed up:
    // 2 of these 5 seeds are found, 3 return null. Both outcomes are acceptable
    // on a camera preview (the next frame gets another go), which is why the
    // assertion is a floor on the count and not "all of them".
    let found = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      if (detectQuad(whiteOnWhite(4, 2, true, seed)) !== null) found++;
    }
    expect(found).toBeGreaterThanOrEqual(2);
    // And the honest failure: at sd 3 a 4-level step is under the noise.
    for (const seed of [1, 2, 3]) {
      expect(detectQuad(whiteOnWhite(4, 3, true, seed))).toBeNull();
    }
  });

  it("gives up rather than guessing once the noise swamps the step", () => {
    // sd 6 noise on a 7-level step. Returning null here is the correct answer:
    // the client presses the shutter themselves, which is a far better outcome
    // than an outline drawn around noise.
    for (const seed of [1, 2, 3]) {
      expect(detectQuad(whiteOnWhite(7, 6, true, seed))).toBeNull();
    }
  });

  it("KNOWN LIMITATION: one strong edge in frame switches the faint pass off", () => {
    // The normalising pass only runs on frames with no strong edge anywhere, so
    // a faint page next to something high-contrast — a dark phone on the table,
    // a window frame in shot — goes undetected even though the page itself is
    // unchanged. This is a deliberate trade: without the gate, three of the
    // detector's structural rejections (a placemat, a page running off the
    // frame, a page with one side missing) flip to false positives. Pinned as a
    // test so the trade is visible and a future change to it is not silent.
    const g = whiteOnWhite(7, 2, true, 1);
    expect(detectQuad(g)).not.toBeNull();
    fillRect(g, 4, 4, 20, 20, 10); // a dark object in the corner
    expect(detectQuad(g)).toBeNull();
  });
});

/* ---------------------------------------- false positives after the fix --- */

describe("detectQuad does not invent a page out of nothing", () => {
  it("returns null for a flat field plus gaussian noise, at every level", () => {
    // The regression the amplifier is most likely to cause, and the one that
    // matters most: a wrong outline that jitters around destroys trust in the
    // feature, whereas no outline just means the client presses the button.
    // Swept across noise levels and seeds because a single fixture would prove
    // nothing here.
    for (const level of [40, 128, 200, 243]) {
      for (const sd of [1, 2, 3, 4, 6, 10]) {
        for (const seed of [1, 2, 3]) {
          const g = makeGray(160, 120, level);
          addNoise(g, sd, seed);
          expect(detectQuad(g)).toBeNull();
        }
      }
    }
  });

  it("returns null for noise on a small frame, where the window stops working", () => {
    // The amplifier compares a pixel smoothed over a 5x5 box against the mean
    // of a box tied to the frame size. On a small frame those two boxes are
    // nearly the same box, so the difference between them is noise rather than
    // "how far is this pixel from its surroundings", and the pass used to turn
    // that into quads on frames the direct pass had correctly rejected
    // (measured: 43x32 sd=3 and 48x36 blurred sd=4 both produced an outline).
    // detectQuad accepts anything down to 24px a side, so the guard lives in
    // the detector rather than in the caller.
    for (let side = 24; side <= 72; side += 4) {
      const w = Math.round((side * 4) / 3);
      for (const sd of [1, 2, 3, 4, 6]) {
        for (const seed of [1, 5, 7]) {
          const g = makeGray(w, side, 214);
          addNoise(g, sd, seed);
          const blurred = blur3(g);
          // The direct pass has its own small-frame weakness at 40px and below
          // (its edge budget is floored at a multiple of the perimeter, which
          // on a tiny frame is a third of the pixels); this test is about the
          // normalised pass not ADDING to that, so it starts where the direct
          // pass is clean.
          if (side < 44) continue;
          expect(detectQuad(g)).toBeNull();
          expect(detectQuad(blurred)).toBeNull();
        }
      }
    }
  });

  it("returns null for a noisy field seen through soft focus", () => {
    // Blurred noise is correlated noise: it forms blobs, and blobs have hulls.
    for (const seed of [1, 2, 3]) {
      const g = makeGray(160, 120, 200);
      addNoise(g, 4, seed);
      expect(detectQuad(blur3(g))).toBeNull();
    }
  });

  it("returns null for a lighting ramp with no document in it", () => {
    for (const slope of [0.1, 0.4, 1.5]) {
      const g = makeGray(160, 120);
      for (let y = 0; y < 120; y++) {
        for (let x = 0; x < 160; x++) g.data[y * 160 + x] = Math.round(60 + x * slope);
      }
      expect(detectQuad(g)).toBeNull();
      // ...and the same ramp with sensor noise on top.
      addNoise(g, 2, 4);
      expect(detectQuad(g)).toBeNull();
    }
  });

  it("returns null for a diagonal ramp with no document in it", () => {
    const g = makeGray(160, 120);
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 160; x++) g.data[y * 160 + x] = Math.round(60 + (x + y) * 0.5);
    }
    expect(detectQuad(g)).toBeNull();
  });

  it("returns null for a vignette with no document in it", () => {
    // A lens vignette is the nastiest no-document case for this pass, because
    // unlike a linear ramp it does NOT cancel against a box mean: curvature
    // leaves a residual everywhere, and the residual is strongest in a ring,
    // which is exactly the shape a hull likes.
    for (const depth of [40, 90]) {
      const g = makeGray(160, 120);
      for (let y = 0; y < 120; y++) {
        for (let x = 0; x < 160; x++) {
          const r = Math.hypot((x - 80) / 80, (y - 60) / 60);
          g.data[y * 160 + x] = Math.round(220 - depth * r * r);
        }
      }
      expect(detectQuad(g)).toBeNull();
      addNoise(g, 2, 6);
      expect(detectQuad(g)).toBeNull();
    }
  });

  it("returns null for a soft blob that is not a document", () => {
    // A shadow or a spill: a large, smooth, edge-free brightness change. The
    // amplifier makes its boundary visible, so the hull is real; it is the
    // shape and support checks that have to hold the line.
    const g = makeGray(160, 120, 243);
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 160; x++) {
        const r = Math.hypot(x - 80, y - 60);
        g.data[y * 160 + x] = Math.round(243 - 8 * Math.exp(-(r * r) / (2 * 35 * 35)));
      }
    }
    addNoise(g, 1, 8);
    expect(detectQuad(g)).toBeNull();
  });

  it("stays deterministic on the amplified path", () => {
    const g = whiteOnWhite(7, 2, true, 1);
    expect(detectQuad(g)).toEqual(detectQuad(g));
    const flat = makeGray(160, 120, 200);
    addNoise(flat, 3, 2);
    expect(detectQuad(flat)).toBeNull();
    expect(detectQuad(flat)).toBeNull();
  });

  it("stays inside the frame budget on the worst case: 640x480, both passes", () => {
    // The most expensive frame the detector can be handed: big, faint, noisy,
    // and with no document in it, so the direct pass finds nothing, the gate
    // opens, and everything runs twice.
    const g = makeGray(640, 480, 243);
    addNoise(g, 2, 11);
    expect(detectQuad(g)).toBeNull();
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      detectQuad(g);
      best = Math.min(best, performance.now() - t0);
    }
    console.log(`detectQuad 640x480 worst case (both passes): ${best.toFixed(1)}ms`);
    expect(best).toBeLessThan(100);
  });

  it("costs no more than before on a frame the direct pass already solves", () => {
    // A found quad must never reach the second pass.
    const g = makeGray(640, 480, 20);
    fillRect(g, 120, 90, 519, 389, 230);
    expect(detectQuad(g)).not.toBeNull();
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      detectQuad(g);
      best = Math.min(best, performance.now() - t0);
    }
    console.log(`detectQuad 640x480 high-contrast (single pass): ${best.toFixed(1)}ms`);
    expect(best).toBeLessThan(100);
  });
});
