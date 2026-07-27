import { describe, it, expect } from "vitest";
import type { Gray } from "./frame-metrics";
import type { Point, Quad } from "./rectify";
import {
  detectQuad,
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

  it("returns null for frames too small to hold a document", () => {
    expect(detectQuad({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull();
    expect(detectQuad(makeGray(1, 1, 255))).toBeNull();
    expect(detectQuad(makeGray(8, 8, 0))).toBeNull();
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

  it("gives up on white-paper-on-white-table (2 grey levels) rather than guessing", () => {
    // Documented limitation, pinned as a test: below ~4 levels of separation the
    // Sobel response is indistinguishable from sensor noise, so we return null
    // instead of an outline that would jitter over nothing.
    const g = makeGray(160, 120, 200);
    fillRect(g, 30, 20, 129, 99, 202);
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
    fillRect(g, 40, 30, 149, 119, 230); // the page
    fillRect(g, 5, 140, 25, 155, 200); // a small bright object in the corner
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
