import { describe, it, expect } from "vitest";
import {
  ZOOM_STEPS,
  MIN_ZOOM,
  MAX_ZOOM,
  nextZoom,
  clampZoom,
  formatZoom,
  clampPage,
  parsePageInput,
  rotateBy,
  pagesToRender,
} from "./viewer-helpers";

describe("nextZoom", () => {
  it("steps up and down through the discrete stops", () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.8);
  });

  it("snaps a between-stops scale to the next stop in that direction", () => {
    // 1.37 is a typical fit-to-width scale; +/- must still move.
    expect(nextZoom(1.37, 1)).toBe(1.5);
    expect(nextZoom(1.37, -1)).toBe(1.25);
  });

  it("clamps at the ends instead of running off", () => {
    expect(nextZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe("clampZoom", () => {
  it("keeps values inside the allowed range", () => {
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(1.25)).toBe(1.25);
  });
  it("falls back to 100% for garbage", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
  });
});

describe("formatZoom", () => {
  it("renders a rounded percentage", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.67)).toBe("67%");
    expect(formatZoom(1.5)).toBe("150%");
  });
});

describe("clampPage", () => {
  it("keeps the page within 1..total", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(99, 10)).toBe(10);
    expect(clampPage(5, 10)).toBe(5);
  });
  it("is safe when there are no pages or input is garbage", () => {
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(Number.NaN, 10)).toBe(1);
  });
});

describe("parsePageInput", () => {
  it("accepts a valid in-range page", () => {
    expect(parsePageInput("7", 10)).toBe(7);
    expect(parsePageInput("  3 ", 10)).toBe(3);
  });
  it("rejects out-of-range and non-numeric input", () => {
    expect(parsePageInput("0", 10)).toBeNull();
    expect(parsePageInput("11", 10)).toBeNull();
    expect(parsePageInput("abc", 10)).toBeNull();
    expect(parsePageInput("", 10)).toBeNull();
  });
});

describe("rotateBy", () => {
  it("normalises to 0/90/180/270 and wraps", () => {
    expect(rotateBy(0, 90)).toBe(90);
    expect(rotateBy(270, 90)).toBe(0);
    expect(rotateBy(0, -90)).toBe(270);
  });
});

describe("pagesToRender (windowed rendering)", () => {
  it("renders only a window around the current page", () => {
    // current=10, overscan=2 → 8..12 mounted out of 300.
    expect(pagesToRender(10, 300, 2)).toEqual([8, 9, 10, 11, 12]);
  });

  it("clips the window at the document edges", () => {
    expect(pagesToRender(1, 300, 3)).toEqual([1, 2, 3, 4]);
    expect(pagesToRender(300, 300, 3)).toEqual([297, 298, 299, 300]);
  });

  it("keeps memory flat: the window never exceeds 2*overscan+1 pages", () => {
    const win = pagesToRender(150, 1000, 3);
    expect(win.length).toBeLessThanOrEqual(7);
  });

  it("returns nothing for an empty document", () => {
    expect(pagesToRender(1, 0, 3)).toEqual([]);
  });
});

describe("ZOOM_STEPS", () => {
  it("includes 100% and is sorted ascending", () => {
    expect(ZOOM_STEPS).toContain(1);
    const sorted = [...ZOOM_STEPS].sort((a, b) => a - b);
    expect([...ZOOM_STEPS]).toEqual(sorted);
  });
});
