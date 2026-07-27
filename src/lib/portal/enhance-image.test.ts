import { describe, it, expect } from "vitest";
import {
  shouldUseRectified,
  detectionScale,
  isEnhanceableImage,
  hasContentOutsideQuad,
  decideRectify,
  isBlankRgba,
  workingScaleFor,
  withTimeout,
  enhancedFilename,
} from "./enhance-image";
import { detectQuad } from "./detect-quad";
import type { Gray } from "./frame-metrics";
import type { Quad } from "./rectify";

/** A quad from four corner points, in the module's TL, TR, BR, BL order. */
function quad(
  tl: [number, number],
  tr: [number, number],
  br: [number, number],
  bl: [number, number],
): Quad {
  return [
    { x: tl[0], y: tl[1] },
    { x: tr[0], y: tr[1] },
    { x: br[0], y: br[1] },
    { x: bl[0], y: bl[1] },
  ] as Quad;
}

const IMAGE = { width: 1000, height: 1400 };

/** Rotate `pts` about (cx, cy) by `deg`, then wrap as a quad. */
function rotated(
  pts: [number, number][],
  cx: number,
  cy: number,
  deg: number,
): Quad {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return pts.map(([x, y]) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  })) as unknown as Quad;
}

/* --- tiny synthetic frames, for the "what am I throwing away?" gate --- */

function makeGray(w: number, h: number, fill: number): Gray {
  const data = new Uint8ClampedArray(w * h);
  data.fill(fill);
  return { data, width: w, height: h };
}

function paint(
  g: Gray,
  x0: number,
  y0: number,
  w: number,
  h: number,
  value: number,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < g.width && y < g.height) {
        g.data[y * g.width + x] = value;
      }
    }
  }
}

/** Deterministic per-pixel jitter, so the fixtures are not perfectly clean. */
function speckle(g: Gray, amplitude: number): void {
  for (let i = 0; i < g.data.length; i++) {
    let x = Math.imul(i + 1, 2654435761) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    g.data[i] = Math.round(
      g.data[i] + ((x >>> 8) / 16777216 - 0.5) * 2 * amplitude,
    );
  }
}

function rgba(
  width: number,
  height: number,
  fill: [number, number, number, number],
): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { data, width, height };
}

describe("shouldUseRectified — when to leave the client's file alone", () => {
  it("declines when nothing was found", () => {
    expect(shouldUseRectified(null, IMAGE)).toEqual({
      use: false,
      reason: "no_document",
    });
  });

  it("declines a quad covering too little of the photo", () => {
    // A picture frame on the wall behind the real subject, say.
    const small = quad([100, 100], [300, 100], [300, 380], [100, 380]);
    expect(shouldUseRectified(small, IMAGE).reason).toBe("too_small");
  });

  it("declines a long thin shape no document has", () => {
    // A door frame or a table leg: big enough to clear the coverage bar (34%
    // of the photo) but far too narrow for its height to be a slip.
    const sliver = quad([330, 0], [670, 0], [670, 1400], [330, 1400]);
    const d = shouldUseRectified(sliver, IMAGE);
    expect(d.reason).toBe("implausible_shape");
    expect(d.use).toBe(false);
  });

  it("declines an image that is already a flat, square-on scan", () => {
    // This is the case the founder worried about: a client picks a proper scan
    // they already had. Re-encoding it costs quality and changes nothing.
    const flat = quad([2, 2], [998, 2], [998, 1398], [2, 1398]);
    expect(shouldUseRectified(flat, IMAGE)).toEqual({
      use: false,
      reason: "already_flat",
    });
  });

  it("accepts a page photographed at an angle — the case this exists for", () => {
    const skewed = quad([140, 210], [880, 130], [930, 1180], [190, 1240]);
    expect(shouldUseRectified(skewed, IMAGE)).toEqual({
      use: true,
      reason: "ok",
    });
  });

  it("accepts a full-bleed page that is still visibly rotated", () => {
    // Covers most of the frame, so coverage is high — but the corners are far
    // off the bounding box, so flattening genuinely helps.
    const rotated = quad([60, 10], [990, 180], [940, 1390], [10, 1220]);
    const d = shouldUseRectified(rotated, IMAGE);
    expect(d.use).toBe(true);
  });

  it("declines rather than guessing on degenerate geometry", () => {
    const collapsed = quad([500, 700], [500, 700], [500, 700], [500, 700]);
    expect(shouldUseRectified(collapsed, IMAGE).use).toBe(false);

    const nan = quad([NaN, 0], [100, 0], [100, 100], [0, 100]);
    expect(shouldUseRectified(nan, IMAGE).use).toBe(false);
  });

  it("declines when the image has no dimensions", () => {
    const any = quad([0, 0], [10, 0], [10, 10], [0, 10]);
    expect(shouldUseRectified(any, { width: 0, height: 0 }).use).toBe(false);
  });

  it("never throws for any of these inputs", () => {
    const cases: (Quad | null)[] = [
      null,
      quad([0, 0], [0, 0], [0, 0], [0, 0]),
      quad([-100, -100], [2000, -100], [2000, 3000], [-100, 3000]),
      quad([Infinity, 0], [1, 0], [1, 1], [0, 1]),
    ];
    for (const c of cases) {
      expect(() => shouldUseRectified(c, IMAGE)).not.toThrow();
    }
  });
});

describe("shouldUseRectified — guards that must not be fooled by rotation", () => {
  it("rejects a long thin object lying diagonally", () => {
    // A ruler, a table edge, a keyboard or a book spine at 45 degrees. Its
    // bounding box is SQUARE (ratio 1.0) and covers 85% of the photo, so both
    // guards used to pass and 90% of the picture was cropped away into a
    // 1400x140 strip. Measured on the quad itself it is what it is: a sliver.
    const bar = rotated(
      [
        [-200, 630],
        [1200, 630],
        [1200, 770],
        [-200, 770],
      ],
      500,
      700,
      45,
    );
    const d = shouldUseRectified(bar, IMAGE);
    expect(d.use).toBe(false);
    expect(["too_small", "implausible_shape"]).toContain(d.reason);
  });

  it("does not let a rotated box inflate coverage past the floor", () => {
    // True area is 14% of the photo — under the 20% floor — but the
    // axis-aligned box around it is 28%, which used to clear it.
    const smallish = rotated(
      [
        [300, 560],
        [700, 560],
        [700, 840],
        [300, 840],
      ],
      500,
      700,
      45,
    );
    expect(shouldUseRectified(smallish, IMAGE).reason).toBe("too_small");
  });
});

describe("shouldUseRectified — leaving flat scans alone", () => {
  it("declines a square-on scan that has a margin around the page", () => {
    // 81% coverage, corners exactly on the bounding box: there is no
    // perspective to correct, so warping it would only cost a downscale and a
    // JPEG re-encode of a file the firm keeps and reads.
    const scan = quad([50, 70], [950, 70], [950, 1330], [50, 1330]);
    expect(shouldUseRectified(scan, IMAGE)).toEqual({
      use: false,
      reason: "already_flat",
    });
  });

  it("declines a square-on scan with a 20px border in a small frame", () => {
    const scan = quad([20, 20], [492, 20], [492, 364], [20, 364]);
    expect(
      shouldUseRectified(scan, { width: 512, height: 384 }).reason,
    ).toBe("already_flat");
  });

  it("still rectifies a square-on slip that is a small part of the photo", () => {
    // 25% coverage: cropping to it is worth real quality to the AI, so the
    // flat-scan exemption must not swallow this case.
    const slip = quad([200, 400], [800, 400], [800, 1000], [200, 1000]);
    expect(shouldUseRectified(slip, IMAGE)).toEqual({ use: true, reason: "ok" });
  });
});

describe("hasContentOutsideQuad — is what we are about to discard empty?", () => {
  it("catches a photo of several receipts and keeps the client's original", () => {
    // The commonest reason a client picks from the library instead of
    // scanning: "here is a photo of all my receipts". detectQuad keeps the
    // largest edge component, so it returns ONE of them and the other two
    // would be silently deleted — the original bytes are never uploaded and
    // the portal has no undo.
    const g = makeGray(512, 384, 128);
    paint(g, 20, 40, 140, 300, 235);
    paint(g, 185, 40, 140, 300, 235);
    paint(g, 350, 40, 140, 300, 235);
    speckle(g, 1);

    const found = detectQuad(g);
    expect(found).not.toBeNull();
    // The shape guards see nothing wrong — this is exactly why the second
    // question has to be asked.
    expect(shouldUseRectified(found, { width: 512, height: 384 }).use).toBe(
      true,
    );
    expect(hasContentOutsideQuad(g, found as Quad)).toBe(true);
    expect(decideRectify(g, found, { width: 512, height: 384 })).toEqual({
      use: false,
      reason: "other_content",
    });
  });

  it("catches two slips side by side even when one is bigger", () => {
    const g = makeGray(512, 384, 120);
    paint(g, 20, 40, 260, 300, 235);
    paint(g, 310, 90, 170, 200, 235);
    speckle(g, 1);
    const found = detectQuad(g);
    expect(found).not.toBeNull();
    expect(hasContentOutsideQuad(g, found as Quad)).toBe(true);
  });

  it("still enhances a single page on a plain table", () => {
    const g = makeGray(512, 384, 112);
    paint(g, 100, 60, 320, 270, 238);
    paint(g, 150, 110, 200, 8, 40); // printed lines on the page
    paint(g, 150, 150, 230, 6, 40);
    speckle(g, 1);
    const found = detectQuad(g);
    expect(found).not.toBeNull();
    expect(hasContentOutsideQuad(g, found as Quad)).toBe(false);
    expect(decideRectify(g, found, { width: 512, height: 384 }).use).toBe(true);
  });

  it("is not vetoed by long thin background structure", () => {
    // Wood grain and a table-edge band produce plenty of edge pixels outside
    // the page. They are not documents, and declining every photo taken on a
    // wooden table would quietly kill the feature.
    const g = makeGray(512, 384, 112);
    for (let y = 0; y < 384; y += 11) paint(g, 0, y, 512, 3, 96);
    paint(g, 100, 60, 320, 270, 238);
    paint(g, 150, 110, 200, 8, 40);
    speckle(g, 1);
    const found = detectQuad(g);
    expect(found).not.toBeNull();
    expect(hasContentOutsideQuad(g, found as Quad)).toBe(false);
  });

  it("never throws on malformed input", () => {
    const g = makeGray(64, 64, 100);
    const ok = quad([1, 1], [60, 1], [60, 60], [1, 60]);
    expect(() => hasContentOutsideQuad(g, ok)).not.toThrow();
    expect(
      hasContentOutsideQuad({ data: new Uint8ClampedArray(4), width: 64, height: 64 }, ok),
    ).toBe(false);
    expect(
      hasContentOutsideQuad(g, quad([NaN, 0], [1, 0], [1, 1], [0, 1])),
    ).toBe(false);
    expect(hasContentOutsideQuad(g, quad([5, 5], [5, 5], [5, 5], [5, 5]))).toBe(
      false,
    );
  });

  it("does not run at all when the shape guards already said no", () => {
    const g = makeGray(512, 384, 128);
    expect(decideRectify(g, null, { width: 512, height: 384 })).toEqual({
      use: false,
      reason: "no_document",
    });
  });
});

describe("isBlankRgba — did the canvas actually produce a picture?", () => {
  it("calls an all-zero buffer blank", () => {
    // This is what iOS Safari hands back when it refuses a canvas backing
    // store: a live context, a silent no-op draw, and every pixel zero. Encoded
    // as JPEG that becomes a valid ~20 KB SOLID BLACK image, which passes a
    // blob.size check and would replace the client's document.
    expect(isBlankRgba(rgba(64, 64, [0, 0, 0, 0]))).toBe(true);
  });

  it("calls a uniform opaque buffer blank", () => {
    expect(isBlankRgba(rgba(64, 64, [0, 0, 0, 255]))).toBe(true);
    expect(isBlankRgba(rgba(64, 64, [255, 255, 255, 255]))).toBe(true);
  });

  it("accepts a buffer with actual content in it", () => {
    const img = rgba(64, 64, [240, 240, 240, 255]);
    for (let i = 0; i < 64; i++) {
      const p = (i * 64 + i) * 4;
      img.data[p] = 10;
      img.data[p + 1] = 10;
      img.data[p + 2] = 10;
    }
    expect(isBlankRgba(img)).toBe(false);
  });

  it("treats a missing or short buffer as blank", () => {
    expect(isBlankRgba({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBe(
      true,
    );
    expect(
      isBlankRgba({ data: new Uint8ClampedArray(16), width: 64, height: 64 }),
    ).toBe(true);
  });
});

describe("workingScaleFor — keeping the intermediate canvas allocatable", () => {
  it("shrinks a 48 MP photo below the phone canvas budget", () => {
    // iPhone HEIF Max: 8064x6048 = 48.8 Mpx, well past iOS Safari's ~16.7 Mpx
    // canvas limit, where drawImage silently no-ops instead of throwing.
    const source = { width: 8064, height: 6048 };
    const s = workingScaleFor(source, 6000);
    expect(source.width * s * (source.height * s)).toBeLessThanOrEqual(12_000_000);
    expect(Math.max(source.width, source.height) * s).toBeLessThanOrEqual(4096);
  });

  it("shrinks a 24 MP photo too — that is the current iPhone default", () => {
    const source = { width: 5712, height: 4284 };
    const s = workingScaleFor(source, 4000);
    expect(source.width * s * (source.height * s)).toBeLessThanOrEqual(12_000_000);
  });

  it("never upscales a small source", () => {
    expect(workingScaleFor({ width: 800, height: 600 }, 400)).toBe(1);
    expect(workingScaleFor({ width: 1600, height: 1200 }, 1500)).toBe(1);
  });

  it("stops at the point where extra source pixels are thrown away anyway", () => {
    // The document's long edge is 4096 source pixels but the output caps at
    // 2048, so drawing at half scale loses nothing and halves the warp's work.
    expect(workingScaleFor({ width: 4032, height: 3024 }, 4096, 2048)).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("survives a degenerate source", () => {
    expect(workingScaleFor({ width: 0, height: 0 }, 100)).toBe(1);
    expect(workingScaleFor({ width: NaN, height: 100 }, 100)).toBe(1);
  });
});

describe("withTimeout — a decode that never settles must not freeze the card", () => {
  it("rejects when the promise never settles", async () => {
    const fired: string[] = [];
    await expect(
      withTimeout(new Promise<never>(() => {}), 10, () => fired.push("cleanup")),
    ).rejects.toThrow("timeout");
    expect(fired).toEqual(["cleanup"]);
  });

  it("passes a value through untouched when it arrives in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("passes the original error through", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("decode_failed")), 1000),
    ).rejects.toThrow("decode_failed");
  });

  it("does not fire the cleanup when the promise resolved", async () => {
    const fired: string[] = [];
    await withTimeout(Promise.resolve(1), 50, () => fired.push("cleanup"));
    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toEqual([]);
  });
});

describe("enhancedFilename — the client's own name survives", () => {
  it("keeps the base name and switches the extension", () => {
    // The filename is often the only thing telling the accountant which
    // document this is, and it is how the client recognises their own upload.
    expect(enhancedFilename("T4-2025-Employer.jpg", 0)).toBe(
      "T4-2025-Employer.jpg",
    );
    expect(enhancedFilename("Releve1-Marie.png", 0)).toBe("Releve1-Marie.jpg");
    expect(enhancedFilename("IMG_0421.HEIC", 0)).toBe("IMG_0421.jpg");
  });

  it("drops any path the picker included", () => {
    expect(enhancedFilename("photos/2025/T4.jpeg", 0)).toBe("T4.jpg");
  });

  it("falls back to the timestamp name when there is nothing to keep", () => {
    expect(enhancedFilename(undefined, 0)).toMatch(/^scan-.*\.jpg$/);
    expect(enhancedFilename("", 0)).toMatch(/^scan-.*\.jpg$/);
    expect(enhancedFilename(".", 0)).toMatch(/^scan-.*\.jpg$/);
    expect(enhancedFilename("   ", 0)).toMatch(/^scan-.*\.jpg$/);
  });

  it("keeps the name short enough for the storage key", () => {
    expect(enhancedFilename(`${"a".repeat(300)}.jpg`, 0).length).toBe(104);
  });
});

describe("detectionScale", () => {
  it("shrinks a big photo down to the detection edge", () => {
    expect(detectionScale({ width: 4032, height: 3024 }, 512)).toBeCloseTo(
      512 / 4032,
      6,
    );
  });

  it("never upscales a photo that is already small", () => {
    expect(detectionScale({ width: 300, height: 200 }, 512)).toBe(1);
  });

  it("keys off the long edge whichever way the photo is turned", () => {
    const landscape = detectionScale({ width: 4000, height: 2000 }, 512);
    const portrait = detectionScale({ width: 2000, height: 4000 }, 512);
    expect(landscape).toBeCloseTo(portrait, 10);
  });

  it("survives a zero-size image", () => {
    expect(detectionScale({ width: 0, height: 0 }, 512)).toBe(1);
  });
});

describe("isEnhanceableImage", () => {
  it("passes PDFs straight through untouched", () => {
    // A PDF is already a document; there is nothing to crop and the pipeline
    // cannot read it anyway.
    expect(isEnhanceableImage({ type: "application/pdf", name: "t4.pdf" })).toBe(
      false,
    );
  });

  it("accepts the photo formats a phone produces", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]) {
      expect(isEnhanceableImage({ type, name: "photo" })).toBe(true);
    }
  });

  it("refuses formats the server would reject, rather than laundering them", () => {
    // The output is always a JPEG, so accepting these would turn a clear
    // "unsupported file" error into a silent partial upload: page 1 of a
    // multi-page TIFF, frame 1 of an animated GIF, or an SVG rasterised at
    // whatever default size the browser picks.
    for (const type of [
      "image/tiff",
      "image/gif",
      "image/svg+xml",
      "image/bmp",
      "image/heic-sequence",
      "image/avif",
    ]) {
      expect(isEnhanceableImage({ type, name: "scan" })).toBe(false);
    }
  });

  it("falls back to the extension when the picker gives no type", () => {
    expect(isEnhanceableImage({ type: "", name: "IMG_0421.HEIC" })).toBe(true);
    expect(isEnhanceableImage({ type: "", name: "scan.jpeg" })).toBe(true);
    expect(isEnhanceableImage({ type: "", name: "statement.pdf" })).toBe(false);
    expect(isEnhanceableImage({ type: "", name: "notes.txt" })).toBe(false);
  });

  it("is not fooled by a filename that merely contains a format word", () => {
    expect(isEnhanceableImage({ type: "", name: "png-instructions.docx" })).toBe(
      false,
    );
  });

  it("handles a file object with neither type nor name", () => {
    expect(isEnhanceableImage({})).toBe(false);
  });
});
