import { describe, it, expect } from "vitest";
import { quadFromPoints, rectangularity, detectQuadCv } from "./cv-detect";
import type { ScanEngine } from "./opencv-loader";

const FRAME = { width: 256, height: 455 };

// A believable sheet of paper: ~45% of the frame, right angles, upright.
const PAPER = [
  { x: 40, y: 90 },
  { x: 216, y: 90 },
  { x: 216, y: 390 },
  { x: 40, y: 390 },
];

describe("quadFromPoints", () => {
  it("accepts a plausible sheet and returns TL,TR,BR,BL", () => {
    const q = quadFromPoints(PAPER, FRAME);
    expect(q).not.toBeNull();
    expect(q![0]).toEqual({ x: 40, y: 90 });
    expect(q![1]).toEqual({ x: 216, y: 90 });
    expect(q![2]).toEqual({ x: 216, y: 390 });
    expect(q![3]).toEqual({ x: 40, y: 390 });
  });

  it("accepts a tilted sheet", () => {
    expect(
      quadFromPoints(
        [
          { x: 50, y: 110 },
          { x: 220, y: 80 },
          { x: 248, y: 370 },
          { x: 78, y: 400 },
        ],
        FRAME,
      ),
    ).not.toBeNull();
  });

  it("rejects anything that is not exactly four points", () => {
    expect(quadFromPoints(PAPER.slice(0, 3), FRAME)).toBeNull();
    expect(quadFromPoints([...PAPER, { x: 1, y: 1 }], FRAME)).toBeNull();
    expect(quadFromPoints([], FRAME)).toBeNull();
  });

  it("rejects a quad too small to be the document being scanned", () => {
    expect(
      quadFromPoints(
        [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 80 },
          { x: 10, y: 80 },
        ],
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects the whole frame — the largest contour on a plain table IS the table", () => {
    expect(
      quadFromPoints(
        [
          { x: 0, y: 0 },
          { x: 256, y: 0 },
          { x: 256, y: 455 },
          { x: 0, y: 455 },
        ],
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects a sliver", () => {
    expect(
      quadFromPoints(
        [
          { x: 10, y: 10 },
          { x: 246, y: 10 },
          { x: 246, y: 13 },
          { x: 10, y: 13 },
        ],
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects a strongly skewed quad whose corners are nowhere near right angles", () => {
    expect(
      quadFromPoints(
        [
          { x: 20, y: 100 },
          { x: 230, y: 100 },
          { x: 250, y: 130 },
          { x: 150, y: 400 },
        ],
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects non-finite coordinates", () => {
    expect(
      quadFromPoints([{ x: Number.NaN, y: 90 }, ...PAPER.slice(1)], FRAME),
    ).toBeNull();
  });

  it("rejects a degenerate frame", () => {
    expect(quadFromPoints(PAPER, { width: 0, height: 0 })).toBeNull();
  });
});

describe("rectangularity", () => {
  // This is the score that picks the page over a blob of couch fabric that
  // merely happens to have four extreme points. Raw area does not — preferring
  // the biggest candidate is exactly how the old detector ended up outlining
  // the page PLUS a band of the fabric beside it.
  it("is 1 for a true rectangle", () => {
    expect(rectangularity(quadFromPoints(PAPER, FRAME)!)).toBeCloseTo(1, 5);
  });

  it("scores a wedge below a rectangle", () => {
    const wedge = quadFromPoints(
      [
        { x: 40, y: 90 },
        { x: 216, y: 130 },
        { x: 216, y: 350 },
        { x: 40, y: 390 },
      ],
      FRAME,
    )!;
    expect(rectangularity(wedge)).toBeLessThan(
      rectangularity(quadFromPoints(PAPER, FRAME)!),
    );
  });

  it("stays within 0..1", () => {
    const r = rectangularity(quadFromPoints(PAPER, FRAME)!);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

// --- the engine wrapper ------------------------------------------------------
// The OpenCV calls are exercised for real in a browser against the founder's
// own photo (the bake-off in the PR). What matters HERE is the contract the
// render loop depends on: a throw anywhere degrades to "nothing found" rather
// than killing the loop, and every Mat is freed — a leak is ~350 KB per
// analysed frame, which at 20fps exhausts the WASM heap in under a minute.

function fakeEngine(throwAt?: string) {
  const freed: string[] = [];
  const mat = (tag: string) => ({ delete: () => freed.push(tag) });
  const base: Record<string, unknown> = {
    Mat: function Mat() {
      return mat("mat");
    },
    MatVector: function MatVector() {
      return {
        size: () => 0,
        get: () => null,
        delete: () => freed.push("vec"),
      };
    },
    Size: function Size() {
      return {};
    },
    matFromImageData: () => {
      if (throwAt === "matFromImageData") throw new Error("heap");
      return mat("src");
    },
  };
  const cv = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (throwAt === prop) {
        return () => {
          throw new Error(prop);
        };
      }
      // Every other cv.* member resolves to a callable returning a number —
      // enough to walk the pipeline without a real OpenCV present.
      return () => 128;
    },
  });
  return { engine: { cv } as unknown as ScanEngine, freed };
}

const RGBA = {
  data: new Uint8ClampedArray(FRAME.width * FRAME.height * 4),
  width: FRAME.width,
  height: FRAME.height,
};

describe("detectQuadCv", () => {
  it("returns null rather than throwing when no contour qualifies", () => {
    const { engine } = fakeEngine();
    expect(detectQuadCv(engine, RGBA)).toBeNull();
  });

  it("swallows a throw from anywhere in the pipeline", () => {
    for (const at of [
      "matFromImageData",
      "cvtColor",
      "GaussianBlur",
      "Canny",
      "morphologyEx",
      "findContours",
    ]) {
      const { engine } = fakeEngine(at);
      expect(detectQuadCv(engine, RGBA)).toBeNull();
    }
  });

  it("frees what it allocated even when the pipeline throws midway", () => {
    const { engine, freed } = fakeEngine("findContours");
    detectQuadCv(engine, RGBA);
    expect(freed.length).toBeGreaterThan(0);
  });

  it("frees what it allocated on the ordinary no-result path", () => {
    const { engine, freed } = fakeEngine();
    detectQuadCv(engine, RGBA);
    expect(freed.length).toBeGreaterThan(0);
  });
});
