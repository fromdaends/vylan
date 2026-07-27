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

  // Read the whole frame once, then warp out of it. Reading only the quad's
  // bounding box would save memory but costs a coordinate rebase for no real
  // gain at these sizes.
  const frame = document.createElement("canvas");
  frame.width = intrinsic.width;
  frame.height = intrinsic.height;
  const fctx = frame.getContext("2d");
  if (!fctx) throw new Error("capture_unsupported");
  fctx.drawImage(video, 0, 0);
  const src = fctx.getImageData(0, 0, intrinsic.width, intrinsic.height);

  const warped = warpToRect(
    { data: src.data, width: src.width, height: src.height },
    sourceQuad,
    target,
  );

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
