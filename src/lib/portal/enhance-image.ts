// Trim-and-flatten for photos the client PICKED rather than scanned.
//
// Apple's file picker always offers "Take Photo or Video" and no web page can
// remove that entry, so a client can still hand us a raw, skewed photo of a
// slip on a table. Rather than fight the picker, we do to the picked image what
// the scanner does to a live frame: find the document, crop to it, flatten the
// angle.
//
// The governing rule is DO NO HARM. This runs on files the client chose
// deliberately — an existing scan, a screenshot, a photo of something that
// isn't a document — so every uncertain case returns the original bytes
// untouched. A slightly skewed upload is a small cost; mangling a file someone
// picked on purpose is not.
//
// Three questions have to be answered "yes" before we replace the client's
// bytes, and each one is a separate gate below, because the first one alone is
// not enough:
//
//   1. Is the thing we found document-SHAPED?     shouldUseRectified
//   2. Is the part we would THROW AWAY empty?     hasContentOutsideQuad
//   3. Is what we PRODUCED actually a picture?    isBlankRgba
//
// Gate 2 exists because the commonest reason a client uses the picker instead
// of the scanner is "here is a photo of all my receipts". The detector keeps
// the largest edge component, so a photo of three slips on a table yields one
// slip and the other two would be silently deleted — the original bytes are
// never uploaded and the portal has no undo. Gate 3 exists because a canvas can
// fail without saying so (iOS Safari hands back a live 2D context over a
// missing backing store when it is past its pixel budget, drawImage no-ops, and
// the transparent result encodes to a SOLID BLACK JPEG that sails through a
// blob.size check).
//
// The decisions are pure and tested here; the canvas work is a thin wrapper at
// the bottom, because canvas is unavailable in the test DOM.

import { detectQuad, edgeThresholdFor, sobelMagnitude } from "./detect-quad";
import { toGrayscale, type Gray, type Rgba } from "./frame-metrics";
import { outputSizeFor, warpToRect, type Point, type Quad } from "./rectify";
import {
  captureFilename,
  fitWithin,
  MAX_CAPTURE_DIMENSION,
  CAPTURE_QUALITY,
  type Size,
} from "./capture-frame";

/** Longest edge we downscale to before looking for the document. */
const DETECT_LONG_EDGE = 512;

/**
 * Give up on a decode after this long and upload the original.
 *
 * An <img> that never fires load OR error is a real WebKit failure mode for a
 * large HEIC under memory pressure, and without this the await never settles:
 * the card stays disabled with a spinner forever, the file input is never
 * cleared (so re-picking the same file fires no change event) and the client's
 * only escape is to guess that reloading the page might help.
 */
export const DECODE_TIMEOUT_MS = 15_000;

/**
 * Ceilings for the intermediate canvas we warp OUT of.
 *
 * iOS Safari refuses to allocate a backing store past roughly 16.7M pixels
 * (4096x4096) and, rather than throwing, hands back a live context over
 * nothing. A current iPhone shoots 24 MP by default and 48 MP in HEIF Max, so
 * drawing the source at its native resolution walks straight into that. We only
 * ever emit MAX_CAPTURE_DIMENSION on the long edge anyway, so drawing the
 * source downscaled costs no output quality — it IMPROVES it, because the
 * browser box-filters a drawImage downscale whereas our 2x2 bilinear sampler
 * aliases when it has to shrink by more than ~1.3x.
 */
const MAX_WORK_PIXELS = 12_000_000;
const MAX_WORK_DIMENSION = 4096;

/**
 * How much of the frame outside the chosen quad may hold a second
 * document-sized object before we decline. Measured on synthetic scenes at the
 * 512px detection size: a second slip beside the first scores 0.44-0.99 of the
 * kept quad's box, while a phone lying beside a page scores 0.09, a table-edge
 * band 0.18 and wood grain effectively nothing (it fails the min-side test).
 */
const OUTSIDE_MAX_AREA_FRACTION = 0.2;
const OUTSIDE_MIN_SIDE_FRACTION = 0.25;
/** Slack around the quad, so the document's own boundary counts as inside. */
const OUTSIDE_MARGIN_FRACTION = 0.03;
const OUTSIDE_MARGIN_MIN = 3;

export type RectifyReason =
  /** Nothing document-shaped found. */
  | "no_document"
  /** Found something, but too small a part of the frame to be the subject. */
  | "too_small"
  /** Already square-on — a scan or a screenshot. Leave it alone. */
  | "already_flat"
  /** Corners imply a shape no document has. */
  | "implausible_shape"
  /** Something document-sized sits OUTSIDE the crop — probably a second slip. */
  | "other_content"
  | "ok";

export type RectifyDecision = { use: boolean; reason: RectifyReason };

function edgeLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Quad area via the shoelace formula — the REAL area, not its bounding box. */
function quadArea(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Whether a detected quad is worth applying to a picked image.
 *
 * Every "no" here means the client's original file is uploaded unchanged.
 *
 * Coverage and the aspect check are both measured on the QUAD, not on its
 * axis-aligned bounding box. A rotated quad's box is up to twice its true area,
 * which used to inflate coverage past the floor, and a diagonal sliver's box is
 * square, which used to defeat the aspect check entirely — so a ruler, a table
 * edge or a book spine lying at 45 degrees passed both guards and got a strip
 * of the photo cropped out with everything else discarded.
 */
export function shouldUseRectified(
  quad: Quad | null,
  image: Size,
): RectifyDecision {
  if (!quad) return { use: false, reason: "no_document" };
  if (image.width <= 0 || image.height <= 0) {
    return { use: false, reason: "no_document" };
  }

  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const boxW = Math.max(...xs) - Math.min(...xs);
  const boxH = Math.max(...ys) - Math.min(...ys);
  if (!Number.isFinite(boxW) || !Number.isFinite(boxH) || boxW <= 0 || boxH <= 0) {
    return { use: false, reason: "no_document" };
  }

  const area = quadArea(quad);
  if (!Number.isFinite(area) || area <= 0) {
    return { use: false, reason: "no_document" };
  }

  const coverage = area / (image.width * image.height);
  // A small quad in a big photo is more likely a book, a tile or a picture
  // frame than the document the client meant to send.
  if (coverage < 0.2) return { use: false, reason: "too_small" };

  // A document is a rectangle. Anything wildly long and thin is a table edge or
  // a windowsill, not a slip. Measured on the quad's own sides — the same two
  // lengths the output size is derived from — so a diagonal sliver reads as the
  // sliver it is.
  const sideW = Math.max(edgeLength(quad[0], quad[1]), edgeLength(quad[3], quad[2]));
  const sideH = Math.max(edgeLength(quad[0], quad[3]), edgeLength(quad[1], quad[2]));
  if (!(sideW > 0) || !(sideH > 0)) {
    return { use: false, reason: "no_document" };
  }
  const ratio = Math.max(sideW, sideH) / Math.min(sideW, sideH);
  if (ratio > 4) return { use: false, reason: "implausible_shape" };

  // If the corners already sit on the bounding box, there is no perspective to
  // correct: the only thing rectifying would do is crop. When the document
  // already dominates the frame that crop is worth nothing and the re-encode
  // costs real quality — this is the "client picked a proper scan" case, and it
  // has to cover a scan with a white margin round the page, not just a
  // full-bleed one.
  const skew = Math.max(
    ...quad.map((p) =>
      Math.min(
        Math.abs(p.x - Math.min(...xs)),
        Math.abs(p.x - Math.max(...xs)),
      ) +
      Math.min(
        Math.abs(p.y - Math.min(...ys)),
        Math.abs(p.y - Math.max(...ys)),
      ),
    ),
  );
  const skewFraction = skew / Math.max(boxW, boxH);
  if (coverage > 0.7 && skewFraction < 0.02) {
    return { use: false, reason: "already_flat" };
  }

  return { use: true, reason: "ok" };
}

/** Is (x, y) inside the convex quad? Boundary counts as inside. */
function insideQuad(quad: Quad, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cr === 0) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Push each corner away from the centroid by `margin` pixels. */
function expandQuad(quad: Quad, margin: number): Quad {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  return quad.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * margin, y: p.y + (dy / len) * margin };
  }) as unknown as Quad;
}

/** Bounding box of the largest 8-connected run of set pixels, or null. */
function largestBlobBox(
  mask: Uint8Array,
  w: number,
  h: number,
): { width: number; height: number; size: number } | null {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best: { width: number; height: number; size: number } | null = null;
  for (let start = 0; start < n; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let size = 0;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const px = p % w;
      const py = (p - px) / w;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] === 1 && seen[q] === 0) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    const box = { width: maxX - minX + 1, height: maxY - minY + 1, size };
    if (best === null || box.size > best.size) best = box;
  }
  return best;
}

/**
 * Is there a second document-sized object OUTSIDE the quad we are about to keep?
 *
 * This is the "is what I am throwing away empty?" question, and it is the one
 * the shape guards cannot answer. detectQuad returns the largest connected edge
 * component, so a photo of three receipts on a table yields exactly one of them
 * and looks perfectly document-shaped doing it.
 *
 * Method: threshold the frame with the DETECTOR'S OWN adaptive threshold, drop
 * everything inside the quad (plus a margin, so the document's own boundary and
 * its shadow do not count against it), then take the largest remaining
 * 8-connected blob. A blob is only treated as another document when its box is
 * a real fraction of the kept quad's box in BOTH area and its shorter side —
 * the second test is what keeps wood grain, a table-edge band and other long
 * thin background structure from vetoing every enhancement.
 */
export function hasContentOutsideQuad(gray: Gray, quad: Quad): boolean {
  const w = gray.width | 0;
  const h = gray.height | 0;
  const n = w * h;
  if (w <= 0 || h <= 0 || gray.data.length < n) return false;
  if (!Array.isArray(quad) || quad.length !== 4) return false;
  if (!quad.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) {
    return false;
  }

  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const boxW = Math.max(...xs) - Math.min(...xs);
  const boxH = Math.max(...ys) - Math.min(...ys);
  if (!(boxW > 0) || !(boxH > 0)) return false;

  const mag = sobelMagnitude(gray);
  const threshold = edgeThresholdFor(mag);
  if (threshold === null) return false;

  const margin = Math.max(
    OUTSIDE_MARGIN_MIN,
    Math.max(boxW, boxH) * OUTSIDE_MARGIN_FRACTION,
  );
  const kept = expandQuad(quad, margin);

  const mask = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mag.data[i] < threshold) continue;
      if (insideQuad(kept, x + 0.5, y + 0.5)) continue;
      mask[i] = 1;
    }
  }

  const blob = largestBlobBox(mask, w, h);
  if (blob === null) return false;

  const areaRatio = (blob.width * blob.height) / (boxW * boxH);
  const sideRatio =
    Math.min(blob.width, blob.height) / Math.min(boxW, boxH);
  return (
    areaRatio >= OUTSIDE_MAX_AREA_FRACTION &&
    sideRatio >= OUTSIDE_MIN_SIDE_FRACTION
  );
}

/**
 * The whole decision, in one place: shape first (cheap), then the much more
 * expensive "is the rest of the photo empty" pass, which only runs if the shape
 * checks already said yes.
 */
export function decideRectify(
  gray: Gray,
  quad: Quad | null,
  image: Size,
): RectifyDecision {
  const shape = shouldUseRectified(quad, image);
  if (!shape.use || !quad) return shape;
  if (hasContentOutsideQuad(gray, quad)) {
    return { use: false, reason: "other_content" };
  }
  return shape;
}

/** Downscale factor to run detection at, given the full image size. */
export function detectionScale(image: Size, longEdge = DETECT_LONG_EDGE): number {
  const longest = Math.max(image.width, image.height);
  if (longest <= 0) return 1;
  return Math.min(1, longEdge / longest);
}

/**
 * Scale to draw the source at before warping out of it.
 *
 * Never upscales, never lets the document region exceed the output cap (past
 * that point the extra source pixels are thrown away by the warp anyway), and
 * never lets the canvas itself exceed what a phone browser will actually
 * allocate. See MAX_WORK_PIXELS.
 */
export function workingScaleFor(
  source: Size,
  quadLongEdge: number,
  maxOutput: number = MAX_CAPTURE_DIMENSION,
): number {
  const w = source.width;
  const h = source.height;
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return 1;
  }
  let scale = 1;
  if (Number.isFinite(quadLongEdge) && quadLongEdge > maxOutput) {
    scale = Math.min(scale, maxOutput / quadLongEdge);
  }
  scale = Math.min(scale, MAX_WORK_DIMENSION / Math.max(w, h));
  scale = Math.min(scale, Math.sqrt(MAX_WORK_PIXELS / (w * h)));
  return Math.min(1, Math.max(0, scale));
}

/**
 * Does this buffer contain a picture at all?
 *
 * Two failure modes look identical from the outside and both end up as a solid
 * black JPEG that a `blob.size > 0` check happily accepts:
 *  - a canvas whose backing store the browser refused, so every pixel reads
 *    zero (alpha included) and toBlob composites the transparency onto black;
 *  - a warp that could not solve, which returns a fully transparent buffer.
 * Sampling a grid of pixels catches both, and also catches a uniform result —
 * where cropping cannot have preserved anything the original did not already
 * say, so handing back the original is never worse.
 */
export function isBlankRgba(rgba: Rgba, samples = 256): boolean {
  if (!rgba || !rgba.data) return true;
  const w = Math.max(0, rgba.width | 0);
  const h = Math.max(0, rgba.height | 0);
  const n = w * h;
  if (!(n > 0) || rgba.data.length < n * 4) return true;

  const stride = Math.max(1, Math.floor(n / Math.max(1, samples)));
  let first = -1;
  for (let i = 0; i < n; i += stride) {
    const p = i * 4;
    if (rgba.data[p + 3] === 0) continue; // transparent: no picture here
    const key =
      rgba.data[p] * 16777216 +
      rgba.data[p + 1] * 65536 +
      rgba.data[p + 2] * 256 +
      rgba.data[p + 3];
    if (first === -1) first = key;
    else if (key !== first) return false;
  }
  // Either every sample was transparent, or every sample was the same colour.
  return true;
}

/** The four image types the server's upload allowlist actually accepts. */
const ENHANCEABLE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/**
 * Whether we should even try.
 *
 * Deliberately an ALLOWLIST rather than "anything image/*". Because the output
 * is always a JPEG, a permissive test lets us convert a file the server would
 * have REJECTED into one it accepts — a clear "unsupported file" error becomes
 * a silent partial upload. A multi-page TIFF loses every page but the first, an
 * animated GIF every frame but the first, and an SVG rasterises at whatever
 * default size the browser picks.
 */
export function isEnhanceableImage(file: {
  type?: string;
  name?: string;
}): boolean {
  const type = (file.type ?? "").trim().toLowerCase();
  if (type) return ENHANCEABLE_MIMES.has(type);
  // Some pickers hand over an empty type; fall back to the extension.
  const name = (file.name ?? "").toLowerCase();
  return /\.(jpe?g|png|webp|heic|heif)$/.test(name);
}

/**
 * Keep the client's own filename on the enhanced file, with a .jpg extension.
 *
 * The name is often the only thing telling the accountant which document this
 * is ("T4-2025-Employer.jpg"), and it is how the client recognises their own
 * upload in the list. Falls back to the scanner's timestamp name when there is
 * nothing usable to keep.
 */
export function enhancedFilename(originalName: string | undefined, at: number): string {
  const leaf = (originalName ?? "").split(/[\\/]/).pop() ?? "";
  const base = leaf.replace(/\.[^.]*$/, "").trim();
  if (!base || /^\.+$/.test(base)) return captureFilename(at);
  return `${base.slice(0, 100)}.jpg`;
}

// ---------------------------------------------------------------------------
// Canvas wrapper — untestable under happy-dom, so it delegates every judgement
// to the pure functions above and swallows failure into "use the original".
// ---------------------------------------------------------------------------

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * Exported for test: everything else in this file degrades to "upload the
 * original", and a promise that never settles is the one failure that instead
 * leaves the card stuck with its buttons disabled.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error("timeout"));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  const decoded = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode_failed"));
    img.src = url;
  });
  return withTimeout(decoded, DECODE_TIMEOUT_MS, () => {
    // Drop the decode so a stalled large HEIC stops holding memory.
    img.onload = null;
    img.onerror = null;
    img.src = "";
  });
}

/**
 * Hand a canvas's backing store back to the browser.
 *
 * On iOS every live canvas stays charged against a process-wide pixel budget
 * until GC runs, and the picker path can be handed five photos in a row.
 * Exceeding that budget is exactly what makes WebKit return blank buffers.
 */
function release(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Trim and flatten a picked photo, or hand back the original untouched.
 *
 * NEVER throws and never returns a worse file: any decode failure, missing
 * canvas, unreadable format (a browser that can't decode HEIC), uncertain
 * detection, a second document in shot or a blank result all end with the
 * caller getting exactly the file it passed in.
 */
export async function enhancePickedImage(file: File): Promise<File> {
  if (!isEnhanceableImage(file)) return file;

  let url: string | null = null;
  let probe: HTMLCanvasElement | null = null;
  let work: HTMLCanvasElement | null = null;
  let out: HTMLCanvasElement | null = null;
  try {
    url = URL.createObjectURL(file);
    const img = await loadImage(url);
    // naturalWidth/Height are the ORIENTED dimensions in current browsers, and
    // drawImage paints the oriented pixels — so this pass also quietly fixes a
    // sideways photo, which is one of the AI's rejection reasons.
    const source: Size = { width: img.naturalWidth, height: img.naturalHeight };
    if (source.width <= 0 || source.height <= 0) return file;

    const scale = detectionScale(source);
    const small = fitWithin(
      { width: source.width * scale, height: source.height * scale },
      DETECT_LONG_EDGE,
    );

    probe = document.createElement("canvas");
    probe.width = small.width;
    probe.height = small.height;
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    if (!pctx) return file;
    pctx.drawImage(img, 0, 0, small.width, small.height);
    const rgba = pctx.getImageData(0, 0, small.width, small.height);
    // If the small canvas came back empty there is nothing to detect on, and
    // whatever we decided from it would be a decision about a blank image.
    if (isBlankRgba(rgba)) return file;
    const gray: Gray = toGrayscale({
      data: rgba.data,
      width: rgba.width,
      height: rgba.height,
    });

    const found = detectQuad(gray);
    const decision = decideRectify(gray, found, small);
    if (!decision.use || !found) return file;

    // Draw the source at the smallest scale that still feeds the output at full
    // quality. This is what keeps the canvas inside a phone's pixel budget, and
    // it also hands the downscale to the browser's own filtered drawImage
    // rather than to our 2x2 bilinear sampler, which aliases fine print when it
    // has to shrink.
    const detectToSourceX = source.width / small.width;
    const detectToSourceY = source.height / small.height;
    const sourceQuadLongEdge = Math.max(
      ...found.map((p, i) => {
        const q = found[(i + 1) % 4];
        return Math.hypot(
          (q.x - p.x) * detectToSourceX,
          (q.y - p.y) * detectToSourceY,
        );
      }),
    );
    const workScale = workingScaleFor(source, sourceQuadLongEdge);
    const workSize = {
      width: Math.max(1, Math.round(source.width * workScale)),
      height: Math.max(1, Math.round(source.height * workScale)),
    };

    const sx = workSize.width / small.width;
    const sy = workSize.height / small.height;
    const workQuad = found.map((p) => ({
      x: p.x * sx,
      y: p.y * sy,
    })) as unknown as Quad;

    work = document.createElement("canvas");
    work.width = workSize.width;
    work.height = workSize.height;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    if (!wctx) return file;
    wctx.drawImage(img, 0, 0, workSize.width, workSize.height);
    const src = wctx.getImageData(0, 0, workSize.width, workSize.height);
    // A browser that refused this canvas returns a live context and an all-zero
    // buffer rather than throwing. Warping that would upload a black rectangle
    // in place of the client's document.
    if (isBlankRgba(src)) return file;

    const target = outputSizeFor(workQuad, MAX_CAPTURE_DIMENSION);
    const warped = warpToRect(
      { data: src.data, width: src.width, height: src.height },
      workQuad,
      target,
    );
    if (isBlankRgba(warped)) return file;

    const outCanvas = document.createElement("canvas");
    out = outCanvas;
    outCanvas.width = warped.width;
    outCanvas.height = warped.height;
    const octx = outCanvas.getContext("2d");
    if (!octx) return file;
    octx.putImageData(
      new ImageData(
        Uint8ClampedArray.from(warped.data),
        warped.width,
        warped.height,
      ),
      0,
      0,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      outCanvas.toBlob((b) => resolve(b), "image/jpeg", CAPTURE_QUALITY);
    });
    if (!blob || blob.size === 0) return file;

    return new File([blob], enhancedFilename(file.name, Date.now()), {
      type: "image/jpeg",
    });
  } catch {
    // Anything at all went wrong — the client's file goes up as they chose it.
    return file;
  } finally {
    if (url) URL.revokeObjectURL(url);
    release(probe);
    release(work);
    release(out);
  }
}

/** Map a picked selection, leaving anything we can't improve untouched. */
export async function enhancePickedFiles(
  files: readonly File[],
): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) out.push(await enhancePickedImage(f));
  return out;
}
