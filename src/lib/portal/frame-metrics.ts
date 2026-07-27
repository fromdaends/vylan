// Live capture-quality signals for the portal's camera. These drive the
// coaching pill ("move closer", "hold steady") and the auto-shutter, so they
// run ~10x/second on a downscaled frame. Kept free of any canvas/DOM/window
// reference: the caller does the getImageData(), we only see plain buffers.
// That is also what makes this file testable under happy-dom, where
// canvas.getContext("2d") returns null.

// An RGBA buffer, the shape you get from ctx.getImageData().
export type Rgba = { data: Uint8ClampedArray; width: number; height: number };

// A single-channel 8-bit buffer: data.length === width * height.
export type Gray = { data: Uint8ClampedArray; width: number; height: number };

/** Rec. 601 luma, one pass. */
export function toGrayscale(src: Rgba): Gray {
  const { width, height, data } = src;
  const n = Math.max(0, width * height);
  const out = new Uint8ClampedArray(n);
  // A short source buffer would otherwise read `undefined` and poison the
  // result with NaN; stop at what is actually there and leave the rest black.
  const count = Math.min(n, Math.floor(data.length / 4));
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    // Uint8ClampedArray rounds half-to-even on store, so round explicitly to
    // keep the result reproducible across engines.
    out[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return { data: out, width, height };
}

export type FrameMetrics = {
  /** Mean luma 0..255. */
  luminance: number;
  /** Variance of the Laplacian over the frame — higher is sharper. */
  sharpness: number;
  /** Mean absolute per-pixel difference vs the previous frame, 0..255. 0 when there is no previous frame. */
  motion: number;
  /** 0..1. Share of the frame the detected document occupies. Caller passes the quad area fraction when it has one; when it does not, estimate from the bright-region bounding box. */
  fill: number;
};

// A frame flatter than this (brightest pixel barely above the mean) carries no
// usable bright/dark split, so the bounding-box fill estimate is meaningless.
const MIN_FILL_CONTRAST = 8;

const EMPTY_METRICS: FrameMetrics = {
  luminance: 0,
  sharpness: 0,
  motion: 0,
  fill: 0,
};

/**
 * @param gray current frame
 * @param prev previous frame's Gray, or null on the first frame. If dimensions differ from `gray`, treat as null.
 * @param quadAreaFraction 0..1 if the caller already has a detected quad, else null (estimate instead).
 */
export function computeMetrics(
  gray: Gray,
  prev: Gray | null,
  quadAreaFraction: number | null,
): FrameMetrics {
  const { width, height, data } = gray;
  const n = width * height;
  // Degenerate or malformed buffer: report "nothing good yet" rather than
  // letting NaN reach the coaching pill.
  // Copied, not shared: handing the same object to every caller would let one
  // of them mutate the module constant for everyone else.
  if (width <= 0 || height <= 0 || data.length < n) return { ...EMPTY_METRICS };

  const prevData =
    prev && prev.width === width && prev.height === height && prev.data.length >= n
      ? prev.data
      : null;

  // Pass 1: mean, peak and frame-to-frame difference share one walk of the
  // buffer since they all need every pixel exactly once.
  let sum = 0;
  let max = 0;
  let motionSum = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    sum += v;
    if (v > max) max = v;
    if (prevData) motionSum += Math.abs(v - prevData[i]);
  }
  const luminance = sum / n;
  const motion = prevData ? motionSum / n : 0;

  // Pass 2: variance of the 4-neighbour Laplacian, border skipped because it
  // has no full neighbourhood. Low variance means no crisp edges = out of
  // focus (this is the classic "variance of Laplacian" blur measure).
  let lSum = 0;
  let lSumSq = 0;
  let lCount = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const l =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
      lSum += l;
      lSumSq += l * l;
      lCount++;
    }
  }
  const lMean = lCount > 0 ? lSum / lCount : 0;
  // Math.max guards the float error that can push a truly flat frame to -1e-12.
  const sharpness = lCount > 0 ? Math.max(0, lSumSq / lCount - lMean * lMean) : 0;

  const fill =
    quadAreaFraction !== null && Number.isFinite(quadAreaFraction)
      ? Math.min(1, Math.max(0, quadAreaFraction))
      : estimateFill(data, width, height, luminance, max);

  return { luminance, sharpness, motion, fill };
}

// Fallback fill for frames where corner detection has not locked on yet:
// threshold at the midpoint between the mean and the brightest pixel (adaptive,
// so it survives both a dim room and a bright desk) and measure the bounding
// box of what is above it.
//
// LIMITATION: this assumes the document is the bright thing against a darker
// background. A white slip on a white desk yields almost no contrast and this
// returns 0; scattered glare or a bright lamp in frame inflates the box toward
// 1. Both are wrong in the direction of "keep coaching, do not fire the
// shutter", and both are why the quad path above exists and is preferred.
function estimateFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mean: number,
  max: number,
): number {
  if (max - mean < MIN_FILL_CONTRAST) return 0;
  const threshold = mean + (max - mean) / 2;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y; // rows are walked in order, so the last hit is the lowest
      }
    }
  }
  if (maxX < 0) return 0;
  return ((maxX - minX + 1) * (maxY - minY + 1)) / (width * height);
}

export type Guidance =
  | "searching" // nothing found / nothing to say yet
  | "too_dark"
  | "too_far" // document too small in frame
  | "hold_steady" // too much motion
  | "blurry"
  | "ready"; // all good — auto-shutter may fire

// Starting points for a phone photographing a white tax slip indoors. They will
// be tuned against real photos; each is deliberately lenient, because a pill
// that nags on a usable frame is worse than one capture the accountant rejects.
export const GUIDANCE_THRESHOLDS: {
  minLuminance: number;
  minSharpness: number;
  maxMotion: number;
  minFill: number;
} = {
  // Mean luma over the whole frame, so the dark background around the slip
  // drags it well below the paper's own brightness. A lit room with a white
  // page in view lands comfortably above 60; below it the capture is
  // underexposed enough that text detail is lost to sensor noise.
  minLuminance: 60,
  // ABSOLUTE floor on the variance of the Laplacian — a backstop against a
  // genuinely mushy frame, not the real focus test. See sharpnessFloorFor:
  // the working threshold is relative to the sharpest frame this session,
  // because the absolute number depends on the phone's own denoising and
  // sharpening and cannot be pinned to a constant. The original 80 was
  // reasoned from full-size-photo advice and measured on nothing; on real
  // hardware it sat above what a phone actually reports for a downscaled
  // frame, so the shutter never armed.
  minSharpness: 20,
  // Mean absolute inter-frame difference. A phone held at arm's length carries
  // more than the 2-4 a steady desk rig suggests once rolling shutter and the
  // sensor's own noise are in the signal; 9 still separates holding still from
  // panning or reaching for the button.
  maxMotion: 9,
  // Share of the frame the document covers. The capture crops to the detected
  // corners, so a smaller document costs resolution rather than correctness —
  // and nagging "move closer" at someone already framed inside the guide is
  // worse than a slightly smaller scan.
  minFill: 0.18,
};

/**
 * The sharpness threshold to actually use, given the sharpest frame seen so
 * far in this session.
 *
 * Variance of the Laplacian has no device-independent scale: it moves with
 * sensor, lighting, how much denoising the phone's imaging pipeline applies,
 * and the downscale size. Judging a frame against the best this camera has
 * managed on this scene self-calibrates, where any fixed constant is either
 * too strict on one phone (the shutter never fires) or too loose on another.
 *
 * `absoluteFloor` still applies, so a scene that has only ever been mush
 * cannot promote its own mush to "sharp".
 */
export function sharpnessFloorFor(
  peakSharpness: number,
  absoluteFloor: number = GUIDANCE_THRESHOLDS.minSharpness,
  fraction = 0.6,
): number {
  const floor = Number.isFinite(absoluteFloor) ? absoluteFloor : 0;
  if (!Number.isFinite(peakSharpness) || peakSharpness <= 0) return floor;
  return Math.max(floor, peakSharpness * fraction);
}

/**
 * Single highest-priority piece of advice. Priority order matters and must be:
 * too_dark > hold_steady > blurry > too_far > ready, with "searching" when
 * `hasDocument` is false and nothing else is wrong.
 * Sharpness is unreliable while the frame is moving, so DO NOT report "blurry"
 * when motion already exceeds the threshold — report hold_steady instead.
 */
export function guidanceFor(
  m: FrameMetrics,
  hasDocument: boolean,
  thresholds?: Partial<typeof GUIDANCE_THRESHOLDS>,
): Guidance {
  // Merge one key at a time rather than spreading. Every check below is a
  // `<`/`>` against the threshold, so an `undefined` or NaN threshold compares
  // false and silently *disables* that check — which fails toward "ready" and
  // an unwanted auto-shutter. A caller forwarding an optional value
  // (`{ minFill: props.minFill }`) is type-legal and would hit exactly that,
  // so ignore anything that is not a real number and keep the default.
  const t = { ...GUIDANCE_THRESHOLDS };
  if (thresholds) {
    for (const key of Object.keys(t) as (keyof typeof t)[]) {
      const v = thresholds[key];
      if (typeof v === "number" && Number.isFinite(v)) t[key] = v;
    }
  }

  // Darkness first: every other measure is derived from a signal the sensor
  // barely captured, so fixing the light fixes the rest.
  if (m.luminance < t.minLuminance) return "too_dark";
  // Motion outranks blur because motion *causes* the low sharpness reading;
  // telling someone to focus while they are still moving is noise.
  if (m.motion > t.maxMotion) return "hold_steady";
  if (m.sharpness < t.minSharpness) return "blurry";
  if (m.fill < t.minFill) return "too_far";
  // Frame is good but no corners yet — say nothing useful rather than arming
  // the shutter on something we have not actually found.
  if (!hasDocument) return "searching";
  return "ready";
}

/**
 * Auto-shutter gate: true once `guidanceFor` has returned "ready" for
 * `requiredFrames` consecutive calls. Pure — the caller owns the counter.
 */
export function shouldAutoCapture(readyStreak: number, requiredFrames: number): boolean {
  // A non-positive requirement is treated as "never fire": a mis-wired caller
  // should not be able to trip the shutter on a streak of zero good frames.
  if (!(requiredFrames > 0)) return false;
  return readyStreak >= requiredFrames;
}
