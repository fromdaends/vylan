import { describe, it, expect } from "vitest";
import {
  toGrayscale,
  computeMetrics,
  guidanceFor,
  shouldAutoCapture,
  GUIDANCE_THRESHOLDS,
  type FrameMetrics,
  type Gray,
  type Rgba,
} from "./frame-metrics";

function makeRgba(
  width: number,
  height: number,
  px: (x: number, y: number) => [number, number, number, number],
): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = px(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

function makeGray(
  width: number,
  height: number,
  at: (x: number, y: number) => number,
): Gray {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = at(x, y);
  }
  return { data, width, height };
}

function grayOf(width: number, height: number, values: number[]): Gray {
  return { data: Uint8ClampedArray.from(values), width, height };
}

describe("toGrayscale", () => {
  it("keeps dimensions and produces one byte per pixel", () => {
    const out = toGrayscale(makeRgba(5, 3, () => [10, 20, 30, 255]));
    expect(out.width).toBe(5);
    expect(out.height).toBe(3);
    expect(out.data.length).toBe(15);
  });

  it("maps pure white to 255 and pure black to 0", () => {
    const src = makeRgba(2, 1, (x) =>
      x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    expect(Array.from(toGrayscale(src).data)).toEqual([255, 0]);
  });

  it("applies Rec. 601 weights per channel", () => {
    const src = makeRgba(3, 1, (x) => {
      if (x === 0) return [255, 0, 0, 255];
      if (x === 1) return [0, 255, 0, 255];
      return [0, 0, 255, 255];
    });
    // 0.299*255 = 76.2, 0.587*255 = 149.7, 0.114*255 = 29.1
    expect(Array.from(toGrayscale(src).data)).toEqual([76, 150, 29]);
  });

  it("passes neutral grays through unchanged", () => {
    const src = makeRgba(3, 1, (x) => {
      const v = [1, 128, 200][x];
      return [v, v, v, 255];
    });
    expect(Array.from(toGrayscale(src).data)).toEqual([1, 128, 200]);
  });

  it("ignores alpha", () => {
    const src = makeRgba(1, 1, () => [255, 255, 255, 0]);
    expect(Array.from(toGrayscale(src).data)).toEqual([255]);
  });

  it("handles a 1x1 frame", () => {
    const src = makeRgba(1, 1, () => [10, 20, 30, 255]);
    // 2.99 + 11.74 + 3.42 = 18.15
    expect(Array.from(toGrayscale(src).data)).toEqual([18]);
  });

  it("returns an empty buffer for a zero-size frame", () => {
    expect(toGrayscale({ data: new Uint8ClampedArray(0), width: 0, height: 0 }).data.length).toBe(0);
  });

  it("does not emit NaN when the source buffer is short", () => {
    const short: Rgba = {
      data: Uint8ClampedArray.from([255, 255, 255, 255]),
      width: 2,
      height: 2,
    };
    expect(Array.from(toGrayscale(short).data)).toEqual([255, 0, 0, 0]);
  });
});

describe("computeMetrics — luminance", () => {
  it("is the mean luma of the frame", () => {
    expect(computeMetrics(grayOf(2, 2, [0, 255, 0, 255]), null, 1).luminance).toBe(127.5);
  });

  it("is 0 for an all-black frame and 255 for an all-white one", () => {
    expect(computeMetrics(makeGray(4, 4, () => 0), null, 1).luminance).toBe(0);
    expect(computeMetrics(makeGray(4, 4, () => 255), null, 1).luminance).toBe(255);
  });

  it("works on a 1x1 frame", () => {
    expect(computeMetrics(grayOf(1, 1, [200]), null, 1).luminance).toBe(200);
  });
});

describe("computeMetrics — sharpness", () => {
  it("is 0 for a flat frame (no edges at all)", () => {
    expect(computeMetrics(makeGray(6, 6, () => 120), null, 1).sharpness).toBe(0);
  });

  it("is 0 for a linear ramp — a smooth gradient carries no Laplacian energy", () => {
    const ramp = makeGray(8, 8, (x) => x * 32);
    expect(computeMetrics(ramp, null, 1).sharpness).toBe(0);
  });

  it("scores a hard vertical edge at the exact Laplacian variance", () => {
    // 4x4, left half black / right half white. The four interior Laplacians are
    // -255, +255, -255, +255 → mean 0, variance 255^2.
    const edge = makeGray(4, 4, (x) => (x < 2 ? 0 : 255));
    expect(computeMetrics(edge, null, 1).sharpness).toBe(65025);
  });

  it("scores a horizontal edge identically to a vertical one (isotropic kernel)", () => {
    const vertical = makeGray(4, 4, (x) => (x < 2 ? 0 : 255));
    const horizontal = makeGray(4, 4, (_x, y) => (y < 2 ? 0 : 255));
    expect(computeMetrics(horizontal, null, 1).sharpness).toBe(65025);
    expect(computeMetrics(horizontal, null, 1).sharpness).toBe(
      computeMetrics(vertical, null, 1).sharpness,
    );
  });

  it("scores a checkerboard (maximum detail) far higher than a single edge", () => {
    // Interior Laplacians are ±1020 → variance 1020^2.
    const checker = makeGray(4, 4, (x, y) => ((x + y) % 2 === 0 ? 255 : 0));
    const m = computeMetrics(checker, null, 1);
    expect(m.sharpness).toBe(1040400);
    expect(m.sharpness).toBeGreaterThan(
      computeMetrics(makeGray(4, 4, (x) => (x < 2 ? 0 : 255)), null, 1).sharpness,
    );
  });

  it("skips the 1px border — blown-out corners do not register as detail", () => {
    // 5x5 flat at 100 with white corners. Corners are never a 4-neighbour of an
    // interior pixel, so every sampled Laplacian is 0. If the border were
    // sampled, this would score in the hundreds of thousands.
    const hotCorners = makeGray(5, 5, (x, y) =>
      (x === 0 || x === 4) && (y === 0 || y === 4) ? 255 : 100,
    );
    expect(computeMetrics(hotCorners, null, 1).sharpness).toBe(0);
  });

  it("has no variance to report when there is exactly one interior pixel", () => {
    const spike = makeGray(3, 3, (x, y) => (x === 1 && y === 1 ? 255 : 0));
    expect(computeMetrics(spike, null, 1).sharpness).toBe(0);
  });

  it("is 0 when the frame is too small to have an interior", () => {
    expect(computeMetrics(grayOf(1, 1, [200]), null, 1).sharpness).toBe(0);
    expect(computeMetrics(grayOf(2, 2, [0, 255, 255, 0]), null, 1).sharpness).toBe(0);
  });
});

describe("computeMetrics — motion", () => {
  it("is 0 when there is no previous frame", () => {
    expect(computeMetrics(grayOf(2, 2, [0, 10, 20, 30]), null, 1).motion).toBe(0);
  });

  it("is 0 between two identical frames", () => {
    const a = makeGray(4, 4, (x, y) => x * 10 + y);
    const b = makeGray(4, 4, (x, y) => x * 10 + y);
    expect(computeMetrics(a, b, 1).motion).toBe(0);
  });

  it("is the mean absolute per-pixel difference", () => {
    const cur = grayOf(2, 2, [0, 10, 20, 30]);
    const prev = grayOf(2, 2, [0, 0, 0, 0]);
    // (0 + 10 + 20 + 30) / 4
    expect(computeMetrics(cur, prev, 1).motion).toBe(15);
  });

  it("is symmetric — a darker previous frame reads the same as a brighter one", () => {
    const a = grayOf(2, 1, [200, 100]);
    const b = grayOf(2, 1, [100, 200]);
    expect(computeMetrics(a, b, 1).motion).toBe(computeMetrics(b, a, 1).motion);
    expect(computeMetrics(a, b, 1).motion).toBe(100);
  });

  it("maxes out at 255 between an all-black and an all-white frame", () => {
    const white = makeGray(4, 4, () => 255);
    const black = makeGray(4, 4, () => 0);
    expect(computeMetrics(white, black, 1).motion).toBe(255);
  });

  it("treats a previous frame of different dimensions as absent", () => {
    const cur = grayOf(2, 2, [255, 255, 255, 255]);
    const prevWrongSize = grayOf(4, 1, [0, 0, 0, 0]);
    expect(computeMetrics(cur, prevWrongSize, 1).motion).toBe(0);
  });
});

describe("computeMetrics — fill", () => {
  it("uses the caller's quad area fraction as-is", () => {
    expect(computeMetrics(makeGray(4, 4, () => 128), null, 0.42).fill).toBe(0.42);
  });

  it("clamps an out-of-range quad fraction into 0..1", () => {
    const g = makeGray(4, 4, () => 128);
    expect(computeMetrics(g, null, 1.5).fill).toBe(1);
    expect(computeMetrics(g, null, -0.2).fill).toBe(0);
  });

  it("prefers the quad fraction over the bright-region estimate", () => {
    // A frame whose bright block would estimate 0.25 still reports the quad.
    const block = makeGray(8, 8, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5 ? 255 : 0));
    expect(computeMetrics(block, null, null).fill).toBe(0.25);
    expect(computeMetrics(block, null, 0.8).fill).toBe(0.8);
  });

  it("estimates the bright region's bounding-box area when there is no quad", () => {
    // 4x4 white block inside an 8x8 black frame = 16/64.
    const block = makeGray(8, 8, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5 ? 255 : 0));
    expect(computeMetrics(block, null, null).fill).toBe(0.25);
  });

  it("reports a near-full frame when the bright block covers most of it", () => {
    // 6x8 block in an 8x8 frame = 48/64.
    const block = makeGray(8, 8, (x) => (x >= 1 && x <= 6 ? 230 : 20));
    expect(computeMetrics(block, null, null).fill).toBe(0.75);
  });

  it("returns 0 for an all-white frame — the white-on-white blind spot", () => {
    expect(computeMetrics(makeGray(8, 8, () => 255), null, null).fill).toBe(0);
  });

  it("returns 0 for an all-black frame", () => {
    expect(computeMetrics(makeGray(8, 8, () => 0), null, null).fill).toBe(0);
  });

  it("returns 0 for a nearly flat frame (contrast below the floor)", () => {
    // Brightest pixel only 4 above the rest: no usable bright/dark split.
    const almostFlat = makeGray(8, 8, (x, y) => (x === 0 && y === 0 ? 124 : 120));
    expect(computeMetrics(almostFlat, null, null).fill).toBe(0);
  });

  it("over-reports on scattered glare — the documented weakness of the estimate", () => {
    const corners = makeGray(8, 8, (x, y) => ((x === 0 && y === 0) || (x === 7 && y === 7) ? 255 : 0));
    expect(computeMetrics(corners, null, null).fill).toBe(1);
  });
});

describe("computeMetrics — degenerate buffers", () => {
  it("returns all-zero metrics for a zero-size frame", () => {
    const empty: Gray = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(computeMetrics(empty, null, 0.5)).toEqual({
      luminance: 0,
      sharpness: 0,
      motion: 0,
      fill: 0,
    });
  });

  it("returns all-zero metrics rather than NaN when the buffer is short", () => {
    const short: Gray = { data: Uint8ClampedArray.from([255, 255]), width: 4, height: 4 };
    const m = computeMetrics(short, null, null);
    expect(m).toEqual({ luminance: 0, sharpness: 0, motion: 0, fill: 0 });
    expect(Number.isNaN(m.luminance)).toBe(false);
  });

  it("ignores a short previous buffer instead of reading past its end", () => {
    const cur = makeGray(4, 4, () => 200);
    const shortPrev: Gray = { data: Uint8ClampedArray.from([0, 0]), width: 4, height: 4 };
    expect(computeMetrics(cur, shortPrev, 1).motion).toBe(0);
  });

  it("returns a fresh object each time, so a caller cannot poison later frames", () => {
    const empty: Gray = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    const first = computeMetrics(empty, null, null);
    expect(computeMetrics(empty, null, null)).not.toBe(first);
    first.fill = 0.99;
    expect(computeMetrics(empty, null, null).fill).toBe(0);
  });

  it("never produces a NaN metric on a realistic frame", () => {
    const g = makeGray(8, 8, (x, y) => (x * 31 + y * 17) % 256);
    const m = computeMetrics(g, makeGray(8, 8, () => 100), null);
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
  });
});

function metrics(over: Partial<FrameMetrics> = {}): FrameMetrics {
  // A comfortably good frame; each test spoils exactly one dimension.
  return { luminance: 140, sharpness: 500, motion: 1, fill: 0.6, ...over };
}

describe("guidanceFor", () => {
  it("says ready when every signal is good and a document is found", () => {
    expect(guidanceFor(metrics(), true)).toBe("ready");
  });

  it("says searching when the frame is fine but no document is found", () => {
    expect(guidanceFor(metrics(), false)).toBe("searching");
  });

  it("says too_dark", () => {
    expect(guidanceFor(metrics({ luminance: 20 }), true)).toBe("too_dark");
  });

  it("says hold_steady", () => {
    expect(guidanceFor(metrics({ motion: 40 }), true)).toBe("hold_steady");
  });

  it("says blurry", () => {
    expect(guidanceFor(metrics({ sharpness: 3 }), true)).toBe("blurry");
  });

  it("says too_far", () => {
    expect(guidanceFor(metrics({ fill: 0.05 }), true)).toBe("too_far");
  });

  it("puts too_dark above everything else", () => {
    expect(
      guidanceFor({ luminance: 5, sharpness: 0, motion: 90, fill: 0 }, false),
    ).toBe("too_dark");
  });

  it("reports hold_steady, not blurry, when the frame is both moving and soft", () => {
    expect(guidanceFor(metrics({ motion: 40, sharpness: 0 }), true)).toBe("hold_steady");
  });

  it("puts blurry above too_far", () => {
    expect(guidanceFor(metrics({ sharpness: 3, fill: 0.01 }), true)).toBe("blurry");
  });

  it("puts too_far above searching — a real complaint beats 'nothing to say'", () => {
    expect(guidanceFor(metrics({ fill: 0.05 }), false)).toBe("too_far");
  });

  it("treats each threshold as inclusive — exactly at the limit is acceptable", () => {
    const atLimit = metrics({
      luminance: GUIDANCE_THRESHOLDS.minLuminance,
      sharpness: GUIDANCE_THRESHOLDS.minSharpness,
      motion: GUIDANCE_THRESHOLDS.maxMotion,
      fill: GUIDANCE_THRESHOLDS.minFill,
    });
    expect(guidanceFor(atLimit, true)).toBe("ready");
  });

  it("complains one step past each limit", () => {
    expect(guidanceFor(metrics({ luminance: GUIDANCE_THRESHOLDS.minLuminance - 1 }), true)).toBe("too_dark");
    expect(guidanceFor(metrics({ motion: GUIDANCE_THRESHOLDS.maxMotion + 0.1 }), true)).toBe("hold_steady");
    expect(guidanceFor(metrics({ sharpness: GUIDANCE_THRESHOLDS.minSharpness - 1 }), true)).toBe("blurry");
    expect(guidanceFor(metrics({ fill: GUIDANCE_THRESHOLDS.minFill - 0.01 }), true)).toBe("too_far");
  });

  it("honours an overridden threshold", () => {
    const dim = metrics({ luminance: 20 });
    expect(guidanceFor(dim, true)).toBe("too_dark");
    expect(guidanceFor(dim, true, { minLuminance: 10 })).toBe("ready");
  });

  it("keeps the defaults for thresholds the caller did not override", () => {
    const dimAndSoft = metrics({ luminance: 20, sharpness: 3 });
    expect(guidanceFor(dimAndSoft, true, { minLuminance: 10 })).toBe("blurry");
  });

  it("keeps the default when an override is explicitly undefined", () => {
    // A caller forwarding an optional prop must not silently switch the check
    // off — an undefined threshold compares false and would report "ready".
    const dark = metrics({ luminance: 20 });
    expect(guidanceFor(dark, true, { minLuminance: undefined })).toBe("too_dark");
    const tiny = metrics({ fill: 0.01 });
    expect(guidanceFor(tiny, true, { minFill: undefined })).toBe("too_far");
    const soft = metrics({ sharpness: 1 });
    expect(guidanceFor(soft, true, { minSharpness: undefined })).toBe("blurry");
    const shaky = metrics({ motion: 50 });
    expect(guidanceFor(shaky, true, { maxMotion: undefined })).toBe("hold_steady");
  });

  it("ignores a NaN threshold rather than disabling the check", () => {
    expect(guidanceFor(metrics({ luminance: 20 }), true, { minLuminance: NaN })).toBe(
      "too_dark",
    );
  });

  it("still applies a legitimate zero override", () => {
    // 0 is falsy but a real threshold: it must replace the default.
    expect(guidanceFor(metrics({ luminance: 0 }), true, { minLuminance: 0 })).toBe("ready");
  });

  it("does not mutate the shared defaults when overriding", () => {
    guidanceFor(metrics(), true, { minLuminance: 999, minFill: 0.99 });
    expect(GUIDANCE_THRESHOLDS.minLuminance).toBe(60);
    expect(GUIDANCE_THRESHOLDS.minFill).toBe(0.25);
  });
});

describe("shouldAutoCapture", () => {
  it("is false before the streak is long enough", () => {
    expect(shouldAutoCapture(0, 3)).toBe(false);
    expect(shouldAutoCapture(2, 3)).toBe(false);
  });

  it("is true once the streak reaches the requirement", () => {
    expect(shouldAutoCapture(3, 3)).toBe(true);
    expect(shouldAutoCapture(9, 3)).toBe(true);
  });

  it("never fires when the requirement is zero or negative", () => {
    expect(shouldAutoCapture(0, 0)).toBe(false);
    expect(shouldAutoCapture(50, 0)).toBe(false);
    expect(shouldAutoCapture(50, -1)).toBe(false);
  });

  it("never fires on a negative streak", () => {
    expect(shouldAutoCapture(-1, 1)).toBe(false);
  });
});

describe("end to end", () => {
  it("coaches a dark frame and stays out of auto-capture", () => {
    const dark = toGrayscale(makeRgba(8, 8, () => [10, 10, 12, 255]));
    const m = computeMetrics(dark, null, 0.6);
    expect(guidanceFor(m, true)).toBe("too_dark");
    expect(shouldAutoCapture(0, 4)).toBe(false);
  });

  it("declares a bright, detailed, still frame with a quad ready", () => {
    const detailed = toGrayscale(
      makeRgba(8, 8, (x, y) => {
        const v = (x + y) % 2 === 0 ? 255 : 90;
        return [v, v, v, 255];
      }),
    );
    const prev = { ...detailed, data: Uint8ClampedArray.from(detailed.data) };
    const m = computeMetrics(detailed, prev, 0.62);
    expect(m.motion).toBe(0);
    expect(guidanceFor(m, true)).toBe("ready");
    expect(shouldAutoCapture(4, 4)).toBe(true);
  });

  it("asks the user to move closer when the slip is a small bright patch", () => {
    // 2x2 bright patch in a 16x16 dim frame = 4/256 of the frame.
    const far = makeGray(16, 16, (x, y) => (x >= 7 && x <= 8 && y >= 7 && y <= 8 ? 250 : 70));
    const m = computeMetrics(far, null, null);
    expect(m.fill).toBeCloseTo(4 / 256, 10);
    expect(guidanceFor(m, false)).toBe("too_far");
  });
});
