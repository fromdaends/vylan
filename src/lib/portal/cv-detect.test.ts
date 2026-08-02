import { describe, it, expect, vi } from "vitest";
import { cornersToQuad, detectQuadCv } from "./cv-detect";
import type { ScanEngine } from "./opencv-loader";

const FRAME = { width: 256, height: 455 };

// A believable sheet of paper: ~46% of the frame, right angles, upright.
const PAPER = {
  topLeftCorner: { x: 40, y: 90 },
  topRightCorner: { x: 216, y: 90 },
  bottomLeftCorner: { x: 40, y: 390 },
  bottomRightCorner: { x: 216, y: 390 },
};

describe("cornersToQuad", () => {
  it("accepts a plausible sheet and returns TL,TR,BR,BL", () => {
    const q = cornersToQuad(PAPER, FRAME);
    expect(q).not.toBeNull();
    expect(q![0]).toEqual(PAPER.topLeftCorner);
    expect(q![1]).toEqual(PAPER.topRightCorner);
    expect(q![2]).toEqual(PAPER.bottomRightCorner);
    expect(q![3]).toEqual(PAPER.bottomLeftCorner);
  });

  it("accepts a tilted sheet", () => {
    const q = cornersToQuad(
      {
        topLeftCorner: { x: 50, y: 110 },
        topRightCorner: { x: 220, y: 80 },
        bottomLeftCorner: { x: 78, y: 400 },
        bottomRightCorner: { x: 248, y: 370 },
      },
      FRAME,
    );
    expect(q).not.toBeNull();
  });

  it("rejects a missing corner", () => {
    // jscanify returns undefined for a quadrant with no contour points —
    // half a document at the frame edge, which cannot be flattened.
    expect(
      cornersToQuad({ ...PAPER, bottomRightCorner: undefined }, FRAME),
    ).toBeNull();
    expect(cornersToQuad(null, FRAME)).toBeNull();
    expect(cornersToQuad(undefined, FRAME)).toBeNull();
  });

  it("rejects a quad too small to be the document being scanned", () => {
    expect(
      cornersToQuad(
        {
          topLeftCorner: { x: 10, y: 10 },
          topRightCorner: { x: 60, y: 10 },
          bottomLeftCorner: { x: 10, y: 80 },
          bottomRightCorner: { x: 60, y: 80 },
        },
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects the whole frame — jscanify returns the largest contour, which on a plain table IS the table", () => {
    expect(
      cornersToQuad(
        {
          topLeftCorner: { x: 0, y: 0 },
          topRightCorner: { x: 256, y: 0 },
          bottomLeftCorner: { x: 0, y: 455 },
          bottomRightCorner: { x: 256, y: 455 },
        },
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects a sliver", () => {
    expect(
      cornersToQuad(
        {
          topLeftCorner: { x: 10, y: 10 },
          topRightCorner: { x: 246, y: 10 },
          bottomLeftCorner: { x: 10, y: 13 },
          bottomRightCorner: { x: 246, y: 13 },
        },
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects a strongly skewed quad whose corners are nowhere near right angles", () => {
    expect(
      cornersToQuad(
        {
          topLeftCorner: { x: 20, y: 100 },
          topRightCorner: { x: 230, y: 100 },
          bottomLeftCorner: { x: 150, y: 400 },
          bottomRightCorner: { x: 250, y: 130 },
        },
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects non-finite coordinates", () => {
    expect(
      cornersToQuad(
        { ...PAPER, topLeftCorner: { x: Number.NaN, y: 90 } },
        FRAME,
      ),
    ).toBeNull();
  });

  it("rejects a degenerate frame", () => {
    expect(cornersToQuad(PAPER, { width: 0, height: 0 })).toBeNull();
  });
});

// --- the engine wrapper ------------------------------------------------------

function fakeEngine(over: Partial<{
  contour: { delete: () => void } | null;
  corners: unknown;
  throwOn: "mat" | "contour" | "corners" | null;
}> = {}) {
  const matDelete = vi.fn();
  const contourDelete = vi.fn();
  const engine = {
    cv: {
      Mat: {},
      matFromImageData: () => {
        if (over.throwOn === "mat") throw new Error("heap");
        return { delete: matDelete };
      },
    },
    scanner: {
      findPaperContour: () => {
        if (over.throwOn === "contour") throw new Error("cv");
        return over.contour === undefined
          ? { delete: contourDelete }
          : over.contour;
      },
      getCornerPoints: () => {
        if (over.throwOn === "corners") throw new Error("cv");
        return (over.corners ?? PAPER) as never;
      },
      extractPaper: () => null,
    },
  } as unknown as ScanEngine;
  return { engine, matDelete, contourDelete };
}

const RGBA = {
  data: new Uint8ClampedArray(FRAME.width * FRAME.height * 4),
  width: FRAME.width,
  height: FRAME.height,
};

describe("detectQuadCv", () => {
  it("returns the validated quad and frees both Mats", () => {
    const { engine, matDelete, contourDelete } = fakeEngine();
    expect(detectQuadCv(engine, RGBA)).not.toBeNull();
    expect(matDelete).toHaveBeenCalledTimes(1);
    expect(contourDelete).toHaveBeenCalledTimes(1);
  });

  it("returns null when no contour was found, still freeing the frame Mat", () => {
    const { engine, matDelete } = fakeEngine({ contour: null });
    expect(detectQuadCv(engine, RGBA)).toBeNull();
    expect(matDelete).toHaveBeenCalledTimes(1);
  });

  it("swallows an OpenCV throw rather than killing the render loop", () => {
    for (const throwOn of ["mat", "contour", "corners"] as const) {
      const { engine } = fakeEngine({ throwOn });
      expect(detectQuadCv(engine, RGBA)).toBeNull();
    }
  });

  it("frees the Mats even when the corner read throws — a leak here exhausts the WASM heap in under a minute at 20fps", () => {
    const { engine, matDelete, contourDelete } = fakeEngine({
      throwOn: "corners",
    });
    detectQuadCv(engine, RGBA);
    expect(matDelete).toHaveBeenCalledTimes(1);
    expect(contourDelete).toHaveBeenCalledTimes(1);
  });

  it("rejects an implausible detection the same way the built-in detector would", () => {
    const { engine } = fakeEngine({
      corners: {
        topLeftCorner: { x: 0, y: 0 },
        topRightCorner: { x: 256, y: 0 },
        bottomLeftCorner: { x: 0, y: 455 },
        bottomRightCorner: { x: 256, y: 455 },
      },
    });
    expect(detectQuadCv(engine, RGBA)).toBeNull();
  });
});
