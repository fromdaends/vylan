import { describe, it, expect } from "vitest";
import {
  coverSourceRect,
  viewPointToSource,
  fitWithin,
  captureFilename,
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
