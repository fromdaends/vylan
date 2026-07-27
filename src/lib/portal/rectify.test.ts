import { describe, it, expect } from "vitest";
import {
  orderCorners,
  solveHomography,
  applyHomography,
  outputSizeFor,
  warpToRect,
  type Point,
  type Quad,
} from "./rectify";
import type { Rgba } from "./frame-metrics";

// ---------------------------------------------------------------------------
// helpers for building small synthetic buffers by hand
// ---------------------------------------------------------------------------

type Px = [number, number, number, number];

function makeRgba(width: number, height: number, fill: Px = [0, 0, 0, 255]) {
  const img: Rgba = {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  };
  for (let i = 0; i < width * height; i++) {
    img.data[i * 4] = fill[0];
    img.data[i * 4 + 1] = fill[1];
    img.data[i * 4 + 2] = fill[2];
    img.data[i * 4 + 3] = fill[3];
  }
  return img;
}

function setPx(img: Rgba, x: number, y: number, px: Px) {
  const i = (y * img.width + x) * 4;
  img.data[i] = px[0];
  img.data[i + 1] = px[1];
  img.data[i + 2] = px[2];
  img.data[i + 3] = px[3];
}

function getPx(img: Rgba, x: number, y: number): Px {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

// Fill every pixel whose CENTRE lies inside the convex quad. Used to paint the
// input for the warp tests; deliberately independent of the warp code.
function fillQuad(img: Rgba, quad: Quad, px: Px) {
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (cross === 0) continue;
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (inside(x + 0.5, y + 0.5)) setPx(img, x, y, px);
    }
  }
}

function rotate(p: Point, deg: number, about: Point): Point {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

function rotations<T>(arr: readonly T[], by: number): T[] {
  return arr.map((_, i) => arr[(i + by) % arr.length]);
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---------------------------------------------------------------------------

describe("orderCorners", () => {
  const square: Point[] = [
    { x: 10, y: 20 },
    { x: 110, y: 20 },
    { x: 110, y: 120 },
    { x: 10, y: 120 },
  ];

  it("returns TL, TR, BR, BL for an already-ordered rectangle", () => {
    expect(orderCorners(square)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 120 },
      { x: 10, y: 120 },
    ]);
  });

  it("gives the same canonical order for every shuffled input order", () => {
    const expected = orderCorners(square);
    expect(expected).not.toBeNull();
    const shuffles: Point[][] = [
      rotations(square, 1),
      rotations(square, 2),
      rotations(square, 3),
      [square[2], square[0], square[3], square[1]],
      [square[3], square[1], square[0], square[2]],
      [square[1], square[3], square[2], square[0]],
    ];
    for (const s of shuffles) {
      expect(orderCorners(s)).toEqual(expected);
    }
  });

  it("survives a ~20 degree rotation of the document", () => {
    const about = { x: 60, y: 70 };
    const tilted = square.map((p) => rotate(p, 20, about));
    const ordered = orderCorners(tilted);
    expect(ordered).not.toBeNull();
    // The corner that was top-left before the rotation must still be TL, etc.
    for (let i = 0; i < 4; i++) {
      expect(ordered![i].x).toBeCloseTo(tilted[i].x, 9);
      expect(ordered![i].y).toBeCloseTo(tilted[i].y, 9);
    }
    // ...and shuffling the tilted input changes nothing.
    expect(orderCorners(rotations(tilted, 3))).toEqual(ordered);
    expect(orderCorners([tilted[2], tilted[0], tilted[3], tilted[1]])).toEqual(
      ordered,
    );
  });

  it("survives a ~-25 degree rotation too", () => {
    const about = { x: 60, y: 70 };
    const tilted = square.map((p) => rotate(p, -25, about));
    const ordered = orderCorners(rotations(tilted, 2));
    expect(ordered).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(ordered![i].x).toBeCloseTo(tilted[i].x, 9);
      expect(ordered![i].y).toBeCloseTo(tilted[i].y, 9);
    }
  });

  it("orders a perspective trapezoid (narrow top, wide bottom)", () => {
    const trapezoid: Point[] = [
      { x: 40, y: 10 }, // TL
      { x: 70, y: 12 }, // TR
      { x: 95, y: 90 }, // BR
      { x: 5, y: 88 }, // BL
    ];
    expect(orderCorners(rotations(trapezoid, 2))).toEqual(trapezoid);
  });

  it("rejects the wrong number of points", () => {
    expect(orderCorners([])).toBeNull();
    expect(orderCorners(square.slice(0, 3))).toBeNull();
    expect(orderCorners([...square, { x: 0, y: 0 }])).toBeNull();
  });

  it("rejects collinear, coincident and non-finite points without NaN", () => {
    expect(
      orderCorners([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ]),
    ).toBeNull();
    expect(
      orderCorners([
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ]),
    ).toBeNull();
    // Three collinear, one off the line is still unusable.
    expect(
      orderCorners([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 10, y: 30 },
      ]),
    ).toBeNull();
    expect(
      orderCorners([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: Number.NaN },
        { x: 0, y: 10 },
      ]),
    ).toBeNull();
  });
});

describe("solveHomography", () => {
  const quad: Quad = [
    { x: 12, y: 8 },
    { x: 96, y: 20 },
    { x: 88, y: 74 },
    { x: 4, y: 60 },
  ];

  it("maps a quad onto itself with the identity matrix", () => {
    const h = solveHomography(quad, quad);
    expect(h).not.toBeNull();
    for (let i = 0; i < 9; i++) {
      expect(h![i]).toBeCloseTo(IDENTITY[i], 9);
    }
  });

  it("normalises so h[8] === 1", () => {
    const dst: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ];
    const h = solveHomography(quad, dst);
    expect(h).not.toBeNull();
    expect(h!).toHaveLength(9);
    expect(h![8]).toBe(1);
  });

  it("round-trips every corner onto its destination", () => {
    const dst: Quad = [
      { x: 0, y: 0 },
      { x: 640, y: 0 },
      { x: 640, y: 480 },
      { x: 0, y: 480 },
    ];
    const h = solveHomography(quad, dst)!;
    expect(h).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const got = applyHomography(h, quad[i]);
      expect(got.x).toBeCloseTo(dst[i].x, 6);
      expect(got.y).toBeCloseTo(dst[i].y, 6);
    }
  });

  it("handles the axis-aligned case that needs partial pivoting", () => {
    // src[0] is the origin, so the very first pivot slot is 0. Without
    // pivoting this branch produces Infinity/NaN or silent garbage.
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const dst: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ];
    const h = solveHomography(src, dst);
    expect(h).not.toBeNull();
    expect(h!.every((v) => Number.isFinite(v))).toBe(true);
    // A pure 1/10 scale.
    expect(h![0]).toBeCloseTo(0.1, 12);
    expect(h![4]).toBeCloseTo(0.1, 12);
    expect(h![1]).toBeCloseTo(0, 12);
    expect(h![2]).toBeCloseTo(0, 12);
    expect(h![6]).toBeCloseTo(0, 12);
    expect(h![7]).toBeCloseTo(0, 12);
    for (let i = 0; i < 4; i++) {
      const got = applyHomography(h!, src[i]);
      expect(got.x).toBeCloseTo(dst[i].x, 9);
      expect(got.y).toBeCloseTo(dst[i].y, 9);
    }
  });

  it("recovers a genuine perspective map, not just an affine one", () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const dst: Quad = [
      { x: 30, y: 40 },
      { x: 200, y: 10 },
      { x: 260, y: 190 },
      { x: 10, y: 150 },
    ];
    const h = solveHomography(src, dst)!;
    expect(h).not.toBeNull();
    // A pure affine map has h[6] === h[7] === 0; this one must not.
    expect(Math.abs(h[6]) + Math.abs(h[7])).toBeGreaterThan(1e-6);
    for (let i = 0; i < 4; i++) {
      const got = applyHomography(h, src[i]);
      expect(got.x).toBeCloseTo(dst[i].x, 6);
      expect(got.y).toBeCloseTo(dst[i].y, 6);
    }
    // Inverting the correspondence must take the destination back to the source.
    const inv = solveHomography(dst, src)!;
    expect(inv).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const back = applyHomography(inv, dst[i]);
      expect(back.x).toBeCloseTo(src[i].x, 9);
      expect(back.y).toBeCloseTo(src[i].y, 9);
    }
  });

  it("returns null (not NaN) for collinear or coincident correspondences", () => {
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];
    const ok: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(solveHomography(line, ok)).toBeNull();
    expect(solveHomography(ok, line)).toBeNull();
    const doubled: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(solveHomography(doubled, ok)).toBeNull();
    const same: Quad = [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 3 },
    ];
    expect(solveHomography(same, ok)).toBeNull();
  });

  it("returns null for non-finite input", () => {
    const bad = [
      { x: 0, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ] as unknown as Quad;
    const ok: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(solveHomography(bad, ok)).toBeNull();
    expect(solveHomography(ok, bad)).toBeNull();
  });

  it("still solves a thin, nearly edge-on quad", () => {
    const thin: Quad = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 3 },
      { x: 0, y: 3 },
    ];
    const dst: Quad = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    const h = solveHomography(thin, dst);
    expect(h).not.toBeNull();
    const got = applyHomography(h!, { x: 200, y: 1.5 });
    expect(got.x).toBeCloseTo(200, 6);
    expect(got.y).toBeCloseTo(150, 6);
  });
});

describe("applyHomography", () => {
  it("leaves a point untouched under the identity", () => {
    const p = applyHomography(IDENTITY, { x: 3.25, y: -7.5 });
    expect(p.x).toBeCloseTo(3.25, 12);
    expect(p.y).toBeCloseTo(-7.5, 12);
  });

  it("applies the perspective divide", () => {
    // w = 1 + 1*x  =>  (4, 8) maps to (4/5, 8/5)
    const h = [1, 0, 0, 0, 1, 0, 1, 0, 1];
    const p = applyHomography(h, { x: 4, y: 8 });
    expect(p.x).toBeCloseTo(0.8, 12);
    expect(p.y).toBeCloseTo(1.6, 12);
  });

  it("returns NaN rather than throwing on a malformed matrix or point", () => {
    expect(applyHomography([1, 0, 0], { x: 1, y: 1 }).x).toBeNaN();
    expect(applyHomography(IDENTITY, { x: NaN, y: 1 }).x).toBeNaN();
  });
});

describe("outputSizeFor", () => {
  it("uses the edge lengths of an axis-aligned rectangle", () => {
    const q: Quad = [
      { x: 10, y: 5 },
      { x: 110, y: 5 },
      { x: 110, y: 55 },
      { x: 10, y: 55 },
    ];
    expect(outputSizeFor(q)).toEqual({ width: 100, height: 50 });
  });

  it("takes the LONGER of each opposing edge pair", () => {
    // Top edge 40 long, bottom edge hypot(100,20) = 101.98; left edge 30 tall,
    // right edge hypot(60,50) = 78.10.
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 30 },
    ];
    const { width, height } = outputSizeFor(q);
    expect(width).toBe(102); // max(40, 101.98) rounded
    expect(height).toBe(78); // max(30, 78.10) rounded
  });

  it("rounds and never returns a zero dimension", () => {
    const tiny: Quad = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0, y: 0.2 },
    ];
    expect(outputSizeFor(tiny)).toEqual({ width: 1, height: 1 });
    const rounded: Quad = [
      { x: 0, y: 0 },
      { x: 10.6, y: 0 },
      { x: 10.6, y: 4.4 },
      { x: 0, y: 4.4 },
    ];
    expect(outputSizeFor(rounded)).toEqual({ width: 11, height: 4 });
  });

  it("clamps to maxDimension while preserving aspect", () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 0, y: 200 },
    ];
    expect(outputSizeFor(q, 100)).toEqual({ width: 100, height: 50 });
    // Tall documents clamp on the height instead.
    const tall: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 800 },
      { x: 0, y: 800 },
    ];
    expect(outputSizeFor(tall, 400)).toEqual({ width: 100, height: 400 });
  });

  it("ignores a maxDimension that is larger than the quad, or nonsense", () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 150 },
      { x: 0, y: 150 },
    ];
    expect(outputSizeFor(q, 5000)).toEqual({ width: 300, height: 150 });
    expect(outputSizeFor(q, 0)).toEqual({ width: 300, height: 150 });
    expect(outputSizeFor(q, -10)).toEqual({ width: 300, height: 150 });
    expect(outputSizeFor(q, Number.NaN)).toEqual({ width: 300, height: 150 });
  });
});

describe("warpToRect", () => {
  const RED: Px = [220, 30, 60, 255];

  it("reproduces the source when the quad is the whole image", () => {
    const src = makeRgba(6, 5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) {
        setPx(src, x, y, [x * 40, y * 50, (x + y) * 20, 255]);
      }
    }
    const full: Quad = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 5 },
      { x: 0, y: 5 },
    ];
    const out = warpToRect(src, full, { width: 6, height: 5 });
    expect(out.width).toBe(6);
    expect(out.height).toBe(5);
    expect(out.data.length).toBe(6 * 5 * 4);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) {
        expect(getPx(out, x, y)).toEqual(getPx(src, x, y));
      }
    }
  });

  it("flattens a rotated parallelogram to a solid rectangle", () => {
    const src = makeRgba(24, 24, [0, 0, 0, 255]);
    const quad: Quad = [
      { x: 6, y: 3 },
      { x: 20, y: 7 },
      { x: 17, y: 20 },
      { x: 3, y: 16 },
    ];
    fillQuad(src, quad, RED);

    const out = warpToRect(src, quad, { width: 8, height: 8 });
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    // Interior pixels sample well inside the shape, so they must be the flat
    // colour; the border ring is allowed to blend with the black field.
    for (let y = 1; y < 7; y++) {
      for (let x = 1; x < 7; x++) {
        const [r, g, b, a] = getPx(out, x, y);
        expect(Math.abs(r - RED[0])).toBeLessThanOrEqual(4);
        expect(Math.abs(g - RED[1])).toBeLessThanOrEqual(4);
        expect(Math.abs(b - RED[2])).toBeLessThanOrEqual(4);
        expect(a).toBe(255);
      }
    }
  });

  it("flattens a GENUINE perspective quad, not just a parallelogram", () => {
    // Every other warp case here is a rectangle or a parallelogram, and both
    // are affine: h[6] and h[7] solve to exactly 0, so the perspective divide
    // in the inner loop never changes a sample. This quad is a real page shot
    // from an angle (narrow top, wide bottom), where it does.
    const quad: Quad = [
      { x: 70, y: 20 },
      { x: 186, y: 20 },
      { x: 240, y: 230 },
      { x: 16, y: 230 },
    ];
    const W = 192;
    const H = 192;
    const rect: Quad = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ];
    // Guard: if a future edit made this quad affine the test would silently
    // stop testing the thing it exists to test.
    const fwd = solveHomography(rect, quad)!;
    expect(Math.abs(fwd[6]) + Math.abs(fwd[7])).toBeGreaterThan(1e-3);

    // Under ANY projective map the intersection of the quad's diagonals is the
    // image of the rectangle's centre, while the average of the four corners is
    // not. Marking both and checking where each lands is what separates a true
    // perspective warp from an affine one: drop the perspective divide and the
    // corner average is what ends up in the middle instead.
    const cross = (a: Point, b: Point, c: Point, d: Point): Point => {
      const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
      const p = a.x * b.y - a.y * b.x;
      const q = c.x * d.y - c.y * d.x;
      return {
        x: (p * (c.x - d.x) - (a.x - b.x) * q) / den,
        y: (p * (c.y - d.y) - (a.y - b.y) * q) / den,
      };
    };
    const diagonal = cross(quad[0], quad[2], quad[1], quad[3]);
    const cornerAvg: Point = {
      x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
      y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
    };

    const src = makeRgba(256, 256, [15, 15, 15, 255]);
    fillQuad(src, quad, [235, 235, 230, 255]);
    const disc = (c: Point, r: number, px: Px) => {
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) <= r) setPx(src, x, y, px);
        }
      }
    };
    disc(diagonal, 3, [20, 30, 220, 255]);
    disc(cornerAvg, 3, [20, 200, 40, 255]);

    const out = warpToRect(src, quad, { width: W, height: H });
    expect(out.width).toBe(W);
    expect(out.height).toBe(H);
    const centroid = (pick: (p: Px) => boolean) => {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let y = 0; y < out.height; y++) {
        for (let x = 0; x < out.width; x++) {
          if (pick(getPx(out, x, y))) {
            n++;
            sx += x + 0.5;
            sy += y + 0.5;
          }
        }
      }
      return { n, x: sx / n, y: sy / n };
    };
    const blue = centroid(([r, g, b]) => b > 150 && r < 120 && g < 120);
    const green = centroid(([r, g, b]) => g > 150 && r < 120 && b < 120);
    expect(blue.n).toBeGreaterThan(8);
    expect(green.n).toBeGreaterThan(8);

    // The diagonal intersection lands dead centre...
    expect(Math.hypot(blue.x - W / 2, blue.y - H / 2)).toBeLessThan(2);
    // ...and the corner average clearly does not.
    expect(Math.hypot(green.x - W / 2, green.y - H / 2)).toBeGreaterThan(8);

    // The page interior is still flat pale, so the warp is not just smearing.
    for (const [x, y] of [
      [8, 8],
      [W - 8, 8],
      [8, H - 8],
      [W - 8, H - 8],
    ]) {
      const [r, g, b, a] = getPx(out, x, y);
      expect({ x, y, r: r > 200, g: g > 200, b: b > 200, a }).toEqual({
        x,
        y,
        r: true,
        g: true,
        b: true,
        a: 255,
      });
    }
  });

  it("respects the TL,TR,BR,BL corner contract (a rotated quad rotates the output)", () => {
    // Left half red, right half blue.
    const src = makeRgba(4, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        setPx(src, x, y, x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
      }
    }
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    // Feed the corners rotated by one: the output's TL now comes from the
    // source's TR, which rotates the image a quarter turn.
    const turned = [
      corners[1],
      corners[2],
      corners[3],
      corners[0],
    ] as unknown as Quad;
    const out = warpToRect(src, turned, { width: 4, height: 4 });
    for (let x = 0; x < 4; x++) {
      expect(getPx(out, x, 0)).toEqual([0, 0, 255, 255]); // top row: was the right half
      expect(getPx(out, x, 3)).toEqual([255, 0, 0, 255]); // bottom row: was the left half
    }
  });

  it("samples bilinearly and clamps out-of-bounds reads to the edge", () => {
    // 2x1: black then white. Stretched to 4 wide, the two outer samples fall
    // outside the source and must clamp; the inner two must interpolate.
    const src = makeRgba(2, 1, [0, 0, 0, 255]);
    setPx(src, 1, 0, [255, 255, 255, 255]);
    const full: Quad = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ];
    const out = warpToRect(src, full, { width: 4, height: 1 });
    const got = [0, 1, 2, 3].map((x) => getPx(out, x, 0)[0]);
    expect(got[0]).toBe(0); // clamped to the black edge pixel
    expect(got[3]).toBe(255); // clamped to the white edge pixel
    expect(Math.abs(got[1] - 64)).toBeLessThanOrEqual(1);
    expect(Math.abs(got[2] - 191)).toBeLessThanOrEqual(1);
    // Strictly increasing proves it is interpolating, not snapping to nearest.
    expect(got[1]).toBeGreaterThan(got[0]);
    expect(got[2]).toBeGreaterThan(got[1]);
    expect(got[3]).toBeGreaterThan(got[2]);
  });

  it("clamps to the edge for a quad that runs off the image", () => {
    const src = makeRgba(4, 4, [10, 20, 30, 255]);
    const outside: Quad = [
      { x: -20, y: -20 },
      { x: -10, y: -20 },
      { x: -10, y: -10 },
      { x: -20, y: -10 },
    ];
    const out = warpToRect(src, outside, { width: 3, height: 3 });
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(getPx(out, x, y)).toEqual([10, 20, 30, 255]);
      }
    }
  });

  it("returns an exactly-sized buffer, normalising a bad out size", () => {
    const src = makeRgba(4, 4, [1, 2, 3, 255]);
    const full: Quad = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const zero = warpToRect(src, full, { width: 0, height: -3 });
    expect(zero.width).toBe(1);
    expect(zero.height).toBe(1);
    expect(zero.data.length).toBe(4);
    const fractional = warpToRect(src, full, { width: 5.9, height: 2.2 });
    expect(fractional.width).toBe(5);
    expect(fractional.height).toBe(2);
    expect(fractional.data.length).toBe(5 * 2 * 4);
  });

  it("returns a transparent buffer for a degenerate quad or an empty source", () => {
    const src = makeRgba(4, 4, [200, 200, 200, 255]);
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    const out = warpToRect(src, line, { width: 3, height: 2 });
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    expect(Array.from(out.data).every((v) => v === 0)).toBe(true);

    const empty: Rgba = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    const full: Quad = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const out2 = warpToRect(empty, full, { width: 2, height: 2 });
    expect(out2.data.length).toBe(16);
    expect(Array.from(out2.data).every((v) => v === 0)).toBe(true);
  });

  it("handles a 1x1 source", () => {
    const src = makeRgba(1, 1, [7, 8, 9, 255]);
    const full: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const out = warpToRect(src, full, { width: 3, height: 3 });
    expect(out.width).toBe(3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(getPx(out, x, y)).toEqual([7, 8, 9, 255]);
      }
    }
  });

  it("carries alpha through the interpolation", () => {
    const src = makeRgba(2, 1, [90, 90, 90, 0]);
    setPx(src, 1, 0, [90, 90, 90, 200]);
    const full: Quad = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ];
    const out = warpToRect(src, full, { width: 2, height: 1 });
    expect(getPx(out, 0, 0)[3]).toBe(0);
    expect(getPx(out, 1, 0)[3]).toBe(200);
  });
});

describe("end to end", () => {
  it("orders detected corners, sizes the output and flattens the document", () => {
    // A pale "page" photographed at an angle on a dark background, with a
    // marker blob near its top-left so we can prove the orientation survives.
    const src = makeRgba(40, 30, [12, 12, 12, 255]);
    const quad: Quad = [
      { x: 8, y: 4 },
      { x: 34, y: 9 },
      { x: 30, y: 26 },
      { x: 4, y: 21 },
    ];
    fillQuad(src, quad, [240, 240, 235, 255]);
    // Marker: a small dark square just inside the TL corner.
    const marker: Quad = [
      { x: 10, y: 6 },
      { x: 15, y: 7 },
      { x: 14, y: 11 },
      { x: 9, y: 10 },
    ];
    fillQuad(src, marker, [20, 30, 200, 255]);

    // Corners arrive from a detector in an arbitrary order.
    const detected = [quad[2], quad[3], quad[0], quad[1]];
    const ordered = orderCorners(detected);
    expect(ordered).toEqual([quad[0], quad[1], quad[2], quad[3]]);

    const size = outputSizeFor(ordered!, 64);
    expect(size.width).toBeGreaterThan(size.height); // landscape page stays landscape
    const out = warpToRect(src, ordered!, size);
    expect(out.width).toBe(size.width);
    expect(out.height).toBe(size.height);

    // The marker must land in the output's top-left quadrant...
    const inQuadrant = (px: number, py: number) =>
      px < out.width / 2 && py < out.height / 2;
    let markerPixels = 0;
    let strays = 0;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const [r, g, b] = getPx(out, x, y);
        if (b > 140 && r < 120 && g < 140) {
          markerPixels++;
          if (!inQuadrant(x, y)) strays++;
        }
      }
    }
    expect(markerPixels).toBeGreaterThan(4);
    expect(strays).toBe(0);

    // ...and the middle of the page must be the flat pale colour, not the
    // dark background bleeding in.
    const mid = getPx(out, Math.floor(out.width / 2), Math.floor(out.height / 2));
    expect(mid[0]).toBeGreaterThan(200);
    expect(mid[1]).toBeGreaterThan(200);
    expect(mid[2]).toBeGreaterThan(200);
  });
});
