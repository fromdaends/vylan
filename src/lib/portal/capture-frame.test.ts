import { describe, it, expect } from "vitest";
import {
  coverSourceRect,
  viewPointToSource,
  fitWithin,
  captureFilename,
  boundedWorkSize,
  isUniform,
} from "./capture-frame";

describe("coverSourceRect", () => {
  it("returns the whole frame when preview and frame share an aspect ratio", () => {
    const r = coverSourceRect(
      { width: 1920, height: 1080 },
      { width: 960, height: 540 },
    );
    expect(r).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("crops the sides when the preview is taller than the frame", () => {
    // 16:9 sensor shown in a 9:16 portrait phone viewport: the full height is
    // visible, the left and right are clipped.
    const r = coverSourceRect(
      { width: 1600, height: 900 },
      { width: 360, height: 640 },
    );
    expect(r.height).toBe(900);
    // visible width = 900 * (360/640) = 506.25
    expect(r.width).toBeCloseTo(506.25, 5);
    // ...centred, so equal margins each side.
    expect(r.x).toBeCloseTo((1600 - 506.25) / 2, 5);
    expect(r.y).toBe(0);
  });

  it("crops top and bottom when the preview is wider than the frame", () => {
    const r = coverSourceRect(
      { width: 900, height: 1600 },
      { width: 640, height: 360 },
    );
    expect(r.width).toBe(900);
    expect(r.height).toBeCloseTo(900 * (360 / 640), 5);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo((1600 - 506.25) / 2, 5);
  });

  it("never reports a visible region larger than the frame itself", () => {
    const r = coverSourceRect(
      { width: 100, height: 100 },
      { width: 4000, height: 10 },
    );
    expect(r.width).toBeLessThanOrEqual(100);
    expect(r.height).toBeLessThanOrEqual(100);
  });

  it("falls back to the full frame when the video has no metadata yet", () => {
    // videoWidth/videoHeight are 0 until loadedmetadata fires.
    expect(
      coverSourceRect({ width: 0, height: 0 }, { width: 360, height: 640 }),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(
      coverSourceRect({ width: 1920, height: 1080 }, { width: 0, height: 0 }),
    ).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("produces no NaN on any degenerate combination", () => {
    for (const intrinsic of [
      { width: 0, height: 0 },
      { width: 0, height: 100 },
      { width: 100, height: 0 },
    ]) {
      const r = coverSourceRect(intrinsic, { width: 50, height: 50 });
      for (const v of [r.x, r.y, r.width, r.height]) {
        expect(Number.isNaN(v)).toBe(false);
      }
    }
  });
});

describe("viewPointToSource", () => {
  const intrinsic = { width: 1600, height: 900 };
  const view = { width: 360, height: 640 };

  it("maps the preview centre to the frame centre", () => {
    const p = viewPointToSource(
      { x: view.width / 2, y: view.height / 2 },
      intrinsic,
      view,
    );
    expect(p.x).toBeCloseTo(800, 5);
    expect(p.y).toBeCloseTo(450, 5);
  });

  it("maps the preview corners onto the visible crop's corners, not the frame's", () => {
    const topLeft = viewPointToSource({ x: 0, y: 0 }, intrinsic, view);
    const crop = coverSourceRect(intrinsic, view);
    expect(topLeft.x).toBeCloseTo(crop.x, 5);
    expect(topLeft.y).toBeCloseTo(crop.y, 5);
    // Crucially NOT (0,0) — that is the bug this function exists to prevent.
    expect(topLeft.x).toBeGreaterThan(0);

    const bottomRight = viewPointToSource(
      { x: view.width, y: view.height },
      intrinsic,
      view,
    );
    expect(bottomRight.x).toBeCloseTo(crop.x + crop.width, 5);
    expect(bottomRight.y).toBeCloseTo(crop.y + crop.height, 5);
  });

  it("is monotonic left-to-right", () => {
    const a = viewPointToSource({ x: 10, y: 0 }, intrinsic, view);
    const b = viewPointToSource({ x: 200, y: 0 }, intrinsic, view);
    expect(b.x).toBeGreaterThan(a.x);
  });
});

describe("fitWithin", () => {
  it("leaves an already-small size untouched", () => {
    expect(fitWithin({ width: 800, height: 600 }, 2048)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("scales the long edge down to the cap and keeps aspect ratio", () => {
    const out = fitWithin({ width: 4000, height: 3000 }, 2048);
    expect(out.width).toBe(2048);
    expect(out.height).toBe(1536);
    expect(out.width / out.height).toBeCloseTo(4000 / 3000, 3);
  });

  it("caps the height when the image is portrait", () => {
    const out = fitWithin({ width: 3000, height: 4000 }, 2048);
    expect(out.height).toBe(2048);
    expect(out.width).toBe(1536);
  });

  it("never returns a zero dimension for an extreme aspect ratio", () => {
    const out = fitWithin({ width: 5000, height: 3 }, 2048);
    expect(out.width).toBe(2048);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  it("rounds to whole pixels", () => {
    const out = fitWithin({ width: 1333.7, height: 999.2 }, 2048);
    expect(Number.isInteger(out.width)).toBe(true);
    expect(Number.isInteger(out.height)).toBe(true);
  });
});

describe("captureFilename", () => {
  it("is storage-safe and keeps the jpg extension", () => {
    const name = captureFilename(Date.UTC(2026, 6, 27, 14, 5, 9, 123));
    expect(name).toBe("scan-2026-07-27T14-05-09-123Z.jpg");
    // No colons or dots beyond the extension — those are what the storage-key
    // sanitiser would otherwise have to strip.
    expect(name.split(".").length).toBe(2);
    expect(name).not.toContain(":");
  });

  it("gives two captures a second apart different names", () => {
    const a = captureFilename(1_000);
    const b = captureFilename(2_000);
    expect(a).not.toBe(b);
  });
});

describe("boundedWorkSize — the canvas iOS will actually back", () => {
  it("never allocates a 4K phone frame at native size", () => {
    // The bug: a 3840x2160 read-back canvas. iOS refuses the backing store past
    // ~16.7M px and does NOT throw — drawImage no-ops and getImageData returns
    // zeros, so the shutter fired and produced nothing.
    const out = boundedWorkSize({ width: 3840, height: 2160 }, 2048);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2048);
    expect(out.width * out.height).toBeLessThan(3840 * 2160);
  });

  it("stays inside the pixel budget even for an absurd sensor", () => {
    const out = boundedWorkSize({ width: 8064, height: 6048 }, 8064);
    expect(out.width * out.height).toBeLessThanOrEqual(12_000_000);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(4096);
  });

  it("never upscales a source smaller than what the output wants", () => {
    const out = boundedWorkSize({ width: 640, height: 480 }, 2048);
    expect(out).toEqual({ width: 640, height: 480 });
  });

  it("keeps the aspect ratio", () => {
    const out = boundedWorkSize({ width: 4000, height: 2250 }, 2048);
    expect(out.width / out.height).toBeCloseTo(4000 / 2250, 2);
  });

  it("survives degenerate input rather than producing a zero-size canvas", () => {
    for (const [src, need] of [
      [{ width: 0, height: 0 }, 2048],
      [{ width: 100, height: 100 }, 0],
      [{ width: 100, height: 100 }, NaN],
    ] as const) {
      const out = boundedWorkSize(src, need);
      expect(out.width).toBeGreaterThanOrEqual(1);
      expect(out.height).toBeGreaterThanOrEqual(1);
      expect(Number.isNaN(out.width + out.height)).toBe(false);
    }
  });
});

describe("isUniform — catching a canvas that lied", () => {
  const solid = (r: number, g: number, b: number, px = 4096) => {
    const d = new Uint8ClampedArray(px * 4);
    for (let i = 0; i < px; i++) {
      d[i * 4] = r;
      d[i * 4 + 1] = g;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = 255;
    }
    return d;
  };

  it("flags an all-zero buffer — the refused-backing-store signature", () => {
    expect(isUniform(new Uint8ClampedArray(4096 * 4))).toBe(true);
  });

  it("flags any solid colour, not just black", () => {
    expect(isUniform(solid(255, 255, 255))).toBe(true);
    expect(isUniform(solid(17, 99, 200))).toBe(true);
  });

  it("passes a real picture", () => {
    const d = solid(120, 120, 120);
    // One different pixel late in the buffer is enough to prove it is not a
    // refused canvas — but it must be at a sampled index, so vary many.
    for (let i = 0; i < d.length; i += 4) d[i] = (i / 4) % 256;
    expect(isUniform(d)).toBe(false);
  });

  it("does not scan every pixel of a huge buffer", () => {
    // 8 megapixels: the check must be cheap enough to run on every capture.
    const big = solid(30, 30, 30, 8_000_000);
    const t0 = performance.now();
    expect(isUniform(big)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("treats an empty buffer as uniform rather than throwing", () => {
    expect(isUniform(new Uint8ClampedArray(0))).toBe(true);
    expect(isUniform(new Uint8ClampedArray(2))).toBe(true);
  });
});
