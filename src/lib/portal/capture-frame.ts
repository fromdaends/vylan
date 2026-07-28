// Geometry for turning a live <video> preview into a still photo.
//
// The preview is painted with `object-fit: cover`, which means the element
// shows a CENTRE CROP of the camera's intrinsic frame — the client never sees
// the full sensor image. `ctx.drawImage(video, 0, 0)` however captures the
// WHOLE intrinsic frame, so a naive capture silently returns more (and
// differently framed) picture than the person actually lined up. Everything
// here exists to keep "what they framed" and "what we upload" identical.
//
// Pure functions only — the canvas-touching wrapper lives at the bottom and is
// deliberately thin, because canvas is unavailable under the test DOM.

import { outputSizeFor, warpToRect, type Quad } from "./rectify";

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The region of an intrinsic `intrinsic`-sized frame that is actually visible
 * when painted `object-fit: cover` into a `view`-sized box.
 *
 * Degenerate inputs (a zero dimension — which is what a <video> reports before
 * metadata loads) fall back to the full intrinsic frame rather than producing
 * NaN, so an early capture yields an uncropped photo instead of a broken one.
 */
export function coverSourceRect(intrinsic: Size, view: Size): Rect {
  const full = {
    x: 0,
    y: 0,
    width: Math.max(0, intrinsic.width),
    height: Math.max(0, intrinsic.height),
  };
  if (
    intrinsic.width <= 0 ||
    intrinsic.height <= 0 ||
    view.width <= 0 ||
    view.height <= 0
  ) {
    return full;
  }
  // `cover` scales so the frame covers the box on BOTH axes: the larger ratio
  // wins and the other axis overflows and gets clipped.
  const scale = Math.max(
    view.width / intrinsic.width,
    view.height / intrinsic.height,
  );
  const visibleWidth = Math.min(intrinsic.width, view.width / scale);
  const visibleHeight = Math.min(intrinsic.height, view.height / scale);
  return {
    x: (intrinsic.width - visibleWidth) / 2,
    y: (intrinsic.height - visibleHeight) / 2,
    width: visibleWidth,
    height: visibleHeight,
  };
}

/**
 * Map a point in on-screen preview coordinates (CSS pixels relative to the
 * video element's top-left) to a point in the intrinsic frame.
 *
 * The document outline is detected and drawn in preview space, but the crop
 * has to happen in intrinsic space at full resolution — this is the bridge.
 */
export function viewPointToSource(
  point: { x: number; y: number },
  intrinsic: Size,
  view: Size,
): { x: number; y: number } {
  const src = coverSourceRect(intrinsic, view);
  if (view.width <= 0 || view.height <= 0) return { x: src.x, y: src.y };
  return {
    x: src.x + (point.x / view.width) * src.width,
    y: src.y + (point.y / view.height) * src.height,
  };
}

/**
 * Clamp a capture to a sane pixel budget, preserving aspect ratio.
 *
 * Phone sensors happily hand back 4000px-wide frames. The AI re-encodes
 * anything over 2048px on the long edge anyway (see normalizeImageForAi), and
 * a client on mobile data pays for every one of those pixels, so capping at
 * 2048 costs nothing in accuracy and saves a multi-megabyte upload.
 */
export function fitWithin(size: Size, maxDimension: number): Size {
  const w = Math.max(1, Math.round(size.width));
  const h = Math.max(1, Math.round(size.height));
  const longest = Math.max(w, h);
  if (maxDimension <= 0 || longest <= maxDimension) return { width: w, height: h };
  const ratio = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
  };
}

/** Long-edge cap for a captured scan. See fitWithin. */
export const MAX_CAPTURE_DIMENSION = 2048;

/** JPEG quality for captures. 0.92 is visually lossless for document text. */
export const CAPTURE_QUALITY = 0.92;

/**
 * Storage-safe filename for a capture.
 *
 * `/api/portal/upload-complete` feeds `file.name` straight through
 * truncateFilename -> safeStorageName -> the storage key, so a nameless
 * canvas-built File would produce a degenerate key. Always explicit, always
 * with an extension.
 */
export function captureFilename(at: number): string {
  const iso = new Date(at).toISOString().replace(/[:.]/g, "-");
  return `scan-${iso}.jpg`;
}

/**
 * Largest canvas we will allocate to read pixels out of.
 *
 * iOS Safari refuses to back a canvas past roughly 16.7M pixels and lies about
 * it (see captureVideoFrameRectified). A current iPhone's rear camera exceeds
 * that on its own, so every read-back path has to be bounded. Kept well under
 * the limit because a phone mid-capture is already holding the video pipeline.
 */
const MAX_WORK_PIXELS = 12_000_000;
const MAX_WORK_DIMENSION = 4096;

/**
 * The size to draw the source at: big enough to feed `neededLongEdge` at full
 * quality, never bigger than the source, and always inside the canvas budget.
 */
export function boundedWorkSize(source: Size, neededLongEdge: number): Size {
  const w = Math.max(1, Math.round(source.width));
  const h = Math.max(1, Math.round(source.height));
  const longest = Math.max(w, h);
  const needed = Number.isFinite(neededLongEdge) && neededLongEdge > 0
    ? neededLongEdge
    : longest;

  // Never upscale, and never draw more than the output can use.
  let scale = Math.min(1, needed / longest);
  // Then clamp to the canvas budget, whichever bound bites first.
  scale = Math.min(scale, MAX_WORK_DIMENSION / longest);
  scale = Math.min(scale, Math.sqrt(MAX_WORK_PIXELS / (w * h)));

  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * True when every sampled pixel is identical — the signature of a canvas whose
 * backing store was refused. A real photograph of a document is never uniform,
 * so this only ever fires on a genuine failure.
 */
export function isUniform(data: Uint8ClampedArray): boolean {
  if (data.length < 4) return true;
  const step = Math.max(4, Math.floor(data.length / 4 / 256) * 4);
  const r = data[0];
  const g = data[1];
  const b = data[2];
  for (let i = 4; i < data.length; i += step) {
    if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Canvas wrapper — untestable under happy-dom (getContext("2d") returns null),
// so it stays as thin as possible and delegates every decision above.
// ---------------------------------------------------------------------------

/**
 * Draw the currently-visible part of `video` onto a canvas and encode it as a
 * JPEG File, ready to hand to the existing portal upload path.
 *
 * `crop` optionally narrows the capture further (the detected document quad's
 * bounding box, in intrinsic coordinates); when omitted the full visible
 * `cover` region is used.
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  opts: { view: Size; crop?: Rect; now?: number } = {
    view: { width: 0, height: 0 },
  },
): Promise<File> {
  const intrinsic = {
    width: video.videoWidth,
    height: video.videoHeight,
  };
  const source = opts.crop ?? coverSourceRect(intrinsic, opts.view);
  const out = fitWithin(
    { width: source.width, height: source.height },
    MAX_CAPTURE_DIMENSION,
  );

  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("capture_unsupported");
  ctx.drawImage(
    video,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    out.width,
    out.height,
  );

  // Same refused-backing-store guard as the rectified path.
  try {
    if (isUniform(ctx.getImageData(0, 0, out.width, out.height).data)) {
      throw new Error("capture_blank");
    }
  } catch (e) {
    if ((e as Error).message === "capture_blank") throw e;
    // getImageData can also fail outright; fall through and let toBlob decide.
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", CAPTURE_QUALITY);
  });
  if (!blob) throw new Error("capture_failed");

  // A canvas-encoded JPEG carries no EXIF, so there is no orientation tag for
  // the AI to misread and no HEIC to transcode — both of which the OS-camera
  // path has to deal with. The pixels are already upright.
  return new File([blob], captureFilename(opts.now ?? Date.now()), {
    type: "image/jpeg",
  });
}

/**
 * Capture just the detected document and flatten it to head-on, so a slip
 * photographed at an angle comes out looking like it came off a scanner.
 *
 * `quad` arrives in PREVIEW coordinates (what was drawn on screen); it is
 * mapped back through the `cover` crop to full-resolution sensor pixels before
 * warping, so the flattening happens at capture quality rather than at preview
 * quality.
 */
export async function captureVideoFrameRectified(
  video: HTMLVideoElement,
  quad: Quad,
  view: Size,
  now?: number,
): Promise<File> {
  const intrinsic = { width: video.videoWidth, height: video.videoHeight };
  const sourceQuad = quad.map((p) =>
    viewPointToSource(p, intrinsic, view),
  ) as unknown as Quad;

  const target = outputSizeFor(sourceQuad, MAX_CAPTURE_DIMENSION);

  // Read the frame at a BOUNDED working scale, never at the sensor's native
  // resolution.
  //
  // This is the bug that made the shutter look broken on a real iPhone. We ask
  // the camera for a large frame, and allocating a canvas that big walks into
  // WebKit's per-canvas pixel budget — past which iOS does NOT throw: it hands
  // back a live 2D context over a refused backing store, drawImage silently
  // no-ops, and getImageData returns zeros. So the shutter fired, the capture
  // either threw or produced a black frame, and the client saw nothing happen
  // while the loop charged up and did it again. (The sibling picked-image path
  // in enhance-image.ts hit the identical trap; this one was missed.)
  //
  // Drawing downscaled costs no output quality — the result is capped at
  // MAX_CAPTURE_DIMENSION anyway, and the browser's own drawImage box-filters
  // the reduction better than our bilinear sampler does.
  // How much of the document's own resolution the output can actually use.
  //
  // BUG THIS FIXES: this used to pass the OUTPUT size as the frame's target
  // long edge, which scaled the WHOLE FRAME down to the size of the cropped
  // document — so a page occupying 440px of a 2560px frame was drawn at ~107px
  // and then warped back up to 440. A 4x upscale of a downscaled image, which
  // is exactly the "document becomes blurry after it zooms in" the founder
  // photographed. The frame must be drawn at a scale where the QUAD still
  // carries the pixels the output needs — which is full resolution whenever
  // the document is smaller than the cap, bounded only by the canvas budget.
  const quadLong = Math.max(
    Math.hypot(sourceQuad[1].x - sourceQuad[0].x, sourceQuad[1].y - sourceQuad[0].y),
    Math.hypot(sourceQuad[3].x - sourceQuad[0].x, sourceQuad[3].y - sourceQuad[0].y),
  );
  const keep =
    quadLong > 0
      ? Math.min(1, Math.max(target.width, target.height) / quadLong)
      : 1;
  const work = boundedWorkSize(
    intrinsic,
    Math.max(intrinsic.width, intrinsic.height) * keep,
  );
  const wx = work.width / intrinsic.width;
  const wy = work.height / intrinsic.height;
  const workQuad = sourceQuad.map((p) => ({
    x: p.x * wx,
    y: p.y * wy,
  })) as unknown as Quad;

  const frame = document.createElement("canvas");
  frame.width = work.width;
  frame.height = work.height;
  const fctx = frame.getContext("2d", { willReadFrequently: true });
  if (!fctx) throw new Error("capture_unsupported");
  fctx.drawImage(video, 0, 0, work.width, work.height);
  const src = fctx.getImageData(0, 0, work.width, work.height);
  // A refused backing store reads back as uniform pixels. Catch it here rather
  // than uploading a black rectangle in place of the client's document.
  if (isUniform(src.data)) throw new Error("capture_blank");

  const warped = warpToRect(
    { data: src.data, width: src.width, height: src.height },
    workQuad,
    target,
  );
  if (isUniform(warped.data)) throw new Error("capture_blank");

  const out = document.createElement("canvas");
  out.width = warped.width;
  out.height = warped.height;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("capture_unsupported");
  // Uint8ClampedArray.from rather than passing warped.data straight in: the
  // buffer type the maths produces is not narrowed to ArrayBuffer, and ImageData
  // refuses a possibly-shared buffer. One copy per capture is free at this size.
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
    out.toBlob((b) => resolve(b), "image/jpeg", CAPTURE_QUALITY);
  });
  if (!blob) throw new Error("capture_failed");
  return new File([blob], captureFilename(now ?? Date.now()), {
    type: "image/jpeg",
  });
}
