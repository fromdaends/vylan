import type { Gray } from "./frame-metrics";
import { orderCorners, type Point, type Quad } from "./rectify";

// Finds the four corners of a document in a downscaled camera frame so the UI
// can draw an outline over the paper and then flatten it. Pure functions over
// typed arrays only — this runs on every animation frame, and it must stay
// testable without a canvas.
//
// Pipeline: sobel -> adaptive threshold -> largest connected edge component ->
// convex hull -> decimate to a few vertices -> pick the max-area inscribed
// quadrilateral -> reject anything that doesn't look like paper.
//
// Why convex hull + max-area quad instead of the classic contour-trace +
// Douglas-Peucker: a thresholded Sobel map is thin and frequently BROKEN (a
// shadow or a low-contrast side leaves a gap). Boundary tracing wanders off down
// the wrong side of a broken stroke and the simplified polygon is then garbage,
// whereas a hull with a gap in it is still roughly the right shape. Note that
// "still roughly right" is NOT the same as "returned": the support check below
// deliberately rejects a candidate whose side has no edge pixels under it,
// because the corners on that side would be guesses. Small gaps survive; a
// wholly missing side does not, and that is the intended trade.
//
// Support is necessary but NOT sufficient, and the gap between the two is a
// dinner plate. The support check asks "is there an edge pixel near this side",
// and the arc of a large round object says yes: a plate, a bowl, a circular
// shadow, a pool of lamp light all get a quad inscribed in their rim by a
// candidate generator whose job is to maximise area. So there is a second,
// independent question — are the sides STRAIGHT? — answered by hasStraightSides
// below. A rectangle's boundary lies on the chord between two adjacent corners;
// a curve's bows away from it.
//
// Known weakness of the hull: clutter *connected to* the document pulls a corner
// outward (a pen lying across the page edge joins the same component), and the
// support check cannot see that because the pen supplies real edge pixels.

export type DetectOptions = {
  /** Ignore quads smaller than this fraction of the frame. Default 0.12. */
  minAreaFraction?: number;
  /** Reject quads whose corners are too far from 90 degrees. Default: cos threshold 0.35 (~70..110 deg). */
  maxCornerCosine?: number;
};

/* ---------------------------------------------------------------- tuning ---
 * These are honest guesses tuned against synthetic frames, not against a real
 * camera. They are the first things to adjust if detection misbehaves on a
 * device.
 */

// Keep roughly the strongest 8% of pixels as edges. A document outline is ~2-3%
// of a frame, so this leaves headroom for texture without letting a whole noisy
// field through.
const EDGE_BUDGET_FRACTION = 0.08;
// ...but never budget fewer pixels than a full-frame outline would need, or a
// high-contrast document that fills a small frame would threshold away to
// nothing.
const EDGE_BUDGET_PERIMETER_MULTIPLE = 6;
// Below this Sobel magnitude we are looking at sensor noise, not a paper edge.
// A step of ~4 grey levels produces a magnitude of 16, so this is already close
// to the limit of what is detectable at all.
const MIN_EDGE_MAGNITUDE = 16;
// A quad this close to the whole frame is the frame itself, not paper on a table.
const MAX_AREA_FRACTION = 0.98;
// Degenerate-sliver guard, as a fraction of the shorter frame side.
const MIN_SIDE_FRACTION = 0.02;
// The candidate's sides must actually sit on edge pixels of the same component.
// This is what separates a document from the convex hull of a random blob.
const SUPPORT_RADIUS = 2;
const MIN_TOTAL_SUPPORT = 0.55;
const MIN_SIDE_SUPPORT = 0.2;

/* ------------------------------------------------ side-straightness tuning ---
 * See hasStraightSides for the reasoning behind the measurement itself; these
 * are the numbers it is judged against, and they come from sweeps rather than
 * from taste.
 *
 * The check runs on BOTH passes, and that was decided by measurement rather
 * than by caution. The obviously safe scoping is "amplified pass only" — that
 * is where the plate was reported, and the direct pass is already pinned by
 * three dozen fixtures. Measured, that scoping is simply worse: on a 960-case
 * sweep of soft round objects (radius 28-55, contrast 18-30 grey levels, four
 * edge softnesses, bright-on-dark and dark-on-bright, three noise seeds) the
 * direct pass produces plenty of the false positives on its own, because a soft
 * rim still clears MIN_EDGE_MAGNITUDE and the direct pass then inscribes the
 * same square in the same ring. Amplified-only leaves most of them standing;
 * on both passes the sweep goes 270/960 -> 0/960, and soft circular shadows and
 * elliptical pools of lamp light go 22/54 -> 0/54.
 *
 * Read that 0/960 as "0 for these fixtures", not as "no round object survives":
 * an independent generator over the SAME parameter box, differing only in using
 * a smoothstep rim ramp instead of a linear one, still gets 16/1680 through. The
 * honest summary of the check's power is in the note above
 * STRAIGHT_MAX_BOW_FRACTION.
 *
 * The cost of the wider scoping, measured the same way: none that shows. A
 * 432-case document sweep (six contrast/noise regimes from a 200-level step to
 * a 5-level one, four rotations, corner roundings to r=12, curls to 5px,
 * perspective taper) returns byte-identical output before and after, corner
 * coordinates included. So does a separate 52-case sweep that adds -30..+30
 * rotations, r=16 rounding, 640x480 and the small-frame case. A guard with no
 * measured cost belongs on every path, not only the one where the bug was
 * noticed.
 */

// Where along each side to sample, as a chord parameter. Stopping well short of
// the corners is deliberate twice over: every shape meets its own chord AT its
// corners, so the ends carry no signal, and a real document's corner is rounded
// — by the paper, by the lens, and by the smoothing inside the amplifier — so
// sampling into it would read the rounding as a bow.
const STRAIGHT_T0 = 0.2;
const STRAIGHT_T1 = 0.8;
// Odd and >= 5, so there is a middle sample and a flank sample at each end.
const STRAIGHT_SAMPLES = 9;
// How far either side of the chord to look for the boundary, as a fraction of
// the side length. A quad inscribed in a circle bows by ~0.207 of its side
// length at mid-side, so the band has to be comfortably wider than that or the
// bow falls outside the search and reads as "no boundary" instead of as a bow.
const STRAIGHT_BAND_FRACTION = 0.35;
const STRAIGHT_BAND_MIN = 6;
// A side may bow by this fraction of its own length before it stops being
// straight. Measured, in units of the side's own length (the statistic is the
// mid-side silhouette minus the silhouette at t = 0.2 and 0.8, so it reads
// about 0.36 of the physical mid-side deviation — that factor applies to both
// columns and cancels):
//
//   soft round object, r=30..46      0.055 .. 0.076   <- must be rejected
//   page with a 5px curl             0.011 .. 0.033   <- must be kept
//   page with r=12 rounded corners  -0.006 .. 0.004
//   page rotated 27 and -17 deg     -0.010 .. 0.000
//   page, plain, high or faint      -0.007 .. 0.003
//
// 0.05 sits between them: 1.5x above the worst genuine page and 1.1x below the
// smallest false positive IN THAT SWEEP. In the underlying geometry the margin
// is the honest one: a circle's mid-side deviation is 0.207 of the side, a 5px
// curl on a 90px page is 0.055 of it, and the threshold is the geometric middle
// of those two.
//
// That 1.1x is not a safety margin, and the round-object column above is NOT a
// floor — it is the range of one sweep. An independent sweep with a smoothstep
// (rather than linear) rim ramp puts round objects below the threshold at both
// ends of the size range:
//
//   filled circle, 256x341, r=80, contrast 45, rim softness 22
//     -> worst side 0.0448, DETECTED (a 134x125 square inscribed in the rim)
//   filled circle, 160x120, r=31..37, contrast 16..55
//     -> worst side 0.047 .. 0.053, DETECTED on ~1% of that grid
//
// So the check removes the large majority of round objects but not all of them:
// measured on a 10800-case independent sweep (three frame sizes, radius from
// the area floor up, contrast 10..55, ten rim softnesses, both polarities),
// 890 false positives before the check and 97 after. At the 256-wide frame the
// camera actually uses it is 62/3840 before and 6/3840 after.
//
// Retuning does NOT close the gap for free, and this was measured rather than
// assumed. Lowering STRAIGHT_MIN_BOW to 2 clears the short-side survivors but
// leaves every 256-wide one standing (those are governed by the fraction, not
// the floor) and costs 363 of 13500 small-frame pages. Lowering the fraction to
// 0.04 starts costing pages in the main sweep as well. The residual is
// therefore a known limitation of a local straightness measure, not a tuning
// oversight — but the numbers above, not the 1.1x, are what a future tolerance
// change has to respect.
const STRAIGHT_MAX_BOW_FRACTION = 0.05;
// ...but never less than this many pixels, because the measurement is quantised
// — a pixel mask walked in half-pixel steps — and the shortest side the detector
// can emit is ~48px (the area floor), where the fractional allowance would be
// 2.4px. Documents measure at most 2.5px of bow anywhere in the sweep, so it
// buys real headroom for a small page.
//
// It is not free, though, and the cost lands exactly where the floor bites: a
// circle small enough to have ~50px sides measures 2.5-2.8px of bow, i.e. under
// this floor but over the 0.05 fraction it overrides, so the floor is what lets
// those through. Dropping it to 2 removes them and costs 363 of 13500 pages on
// small frames (sides down to ~26px), which is the wrong trade for a detector
// whose production frame is 256 wide. See the note above STRAIGHT_MAX_BOW_FRACTION.
const STRAIGHT_MIN_BOW = 3;
// Vertex budget handed to the max-area-quad search (its cost is O(n^4)).
const MAX_POLY_VERTICES = 24;
// Hull vertices this close to the chord through their neighbours are
// rasterisation staircase, not corners. Dropping them is a cost optimisation
// rather than a correctness one — the quad search below is O(n^4), so trimming
// a hull from 24 vertices to 6 is roughly a 700x saving per frame.
const COLLINEAR_EPSILON = 1;
// Guard against pathological hulls before the O(n^2) decimation.
const MAX_HULL_VERTICES = 400;
// A frame smaller than this cannot hold a document outline worth tracing.
const MIN_FRAME_SIDE = 24;

/* --------------------------------------- local contrast normalisation tuning ---
 * See normaliseLocalContrast for the reasoning behind each of these.
 */

// Side of the box window used for the local mean/spread, as a fraction of the
// shorter frame side. A quarter of the frame is wide enough that a window
// straddling the paper boundary still contains a healthy amount of both sides
// (so the measured spread really is the step), and small enough that a lighting
// ramp across the frame is flattened rather than preserved. An eighth also
// works but detects fewer of the faint cases, because the spread estimate is
// noisier and the halo around each edge is tighter.
const NORM_WINDOW_FRACTION = 0.25;
// Output spread we rescale a neighbourhood to, in grey levels.
const NORM_TARGET_SPREAD = 48;
// Divide-by-nothing guard, in grey levels. A neighbourhood whose spread is
// below this is treated as flat: blank paper, an empty wall, or pure sensor
// noise. Without the floor those regions get multiplied by an unbounded gain
// and the frame fills with fake edges. With it, the gain saturates at
// NORM_TARGET_SPREAD / NORM_MIN_SPREAD (6x here), so flat stays flat-ish.
const NORM_MIN_SPREAD = 8;
// Radius of the box smoothing applied to the pixel BEFORE it is compared with
// its neighbourhood. This is not cosmetic — it is the reason the pass works at
// all. See the note in normaliseLocalContrast. Held in pixels, not scaled to
// the frame, because it targets per-pixel sensor noise, which does not get
// bigger when the frame does.
const NORM_SMOOTH_RADIUS = 2;
// How much bigger than the smoothing box the neighbourhood box has to be before
// the normalised frame is worth detecting on. The pass compares a pixel
// smoothed over one box against the mean over another, and that comparison only
// means "how far is this pixel from its surroundings" while the second box is
// much the larger of the two. As they converge, the two boxes average nearly
// the same pixels, the difference between them stops measuring the surroundings
// and starts measuring the noise inside a handful of pixels, and the divisor —
// a spread estimated from a window that small — is too unreliable to hold the
// gain down. Measured: on frames whose shorter side is under ~48px the pass
// then finds quads in pure sensor noise that the direct pass correctly
// rejected. NORM_WINDOW_FRACTION ties the window to the frame, so this ratio is
// really a minimum frame size: 4 * 2 / (0.25 / 2) = a shorter side of 64px.
const NORM_MIN_WINDOW_RATIO = 4;
// The normalising pass only runs on a frame with no strong edge anywhere in it.
// "Strong" is the Sobel magnitude at the top NORM_TRIGGER_FRACTION of pixels —
// a small percentile rather than the single maximum, so one hot pixel or a
// speck of dust cannot speak for the whole frame.
//
// 64 is a sharp 16-grey-level step. Measured on the fixtures, the separation is
// not close: a faint page reads 31 here, a noise field 25, a vignette 29, while
// a placemat, a plate, a page overflowing the frame, or ANY hard-edged object
// in shot reads 255.
//
// 0.25% of the frame (48 pixels at 160x120) is deliberately small. At 1% a dark
// object the size of a stamp did not register, the pass ran anyway, and its
// halo bridged the gap to the page and dragged a corner 20px out — a visibly
// wrong outline. Small clutter has to be able to veto the pass, and the cost of
// vetoing is only that we show no outline.
const NORM_TRIGGER_MAGNITUDE = 64;
const NORM_TRIGGER_FRACTION = 0.0025;

/* ------------------------------------------------------------ public API --- */

/** Sobel magnitude map, same dimensions as input. Values clamped to 0..255. */
export function sobelMagnitude(gray: Gray): Gray {
  const w = Math.max(0, gray.width | 0);
  const h = Math.max(0, gray.height | 0);
  const n = w * h;
  const out = new Uint8ClampedArray(n);
  // A short buffer means the caller handed us a malformed frame; a flat map is
  // safer than reading undefined into NaN.
  if (n === 0 || gray.data.length < n) return { data: out, width: w, height: h };

  const src = gray.data;
  for (let y = 0; y < h; y++) {
    // Borders replicate the edge pixel, so a uniform frame yields zero
    // everywhere rather than a bright rectangle around the outside.
    const rowUp = clampInt(y - 1, 0, h - 1) * w;
    const rowMid = y * w;
    const rowDown = clampInt(y + 1, 0, h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xl = clampInt(x - 1, 0, w - 1);
      const xr = clampInt(x + 1, 0, w - 1);
      const tl = src[rowUp + xl];
      const tc = src[rowUp + x];
      const tr = src[rowUp + xr];
      const ml = src[rowMid + xl];
      const mr = src[rowMid + xr];
      const bl = src[rowDown + xl];
      const bc = src[rowDown + x];
      const br = src[rowDown + xr];
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      out[rowMid + x] = Math.min(255, Math.round(Math.sqrt(gx * gx + gy * gy)));
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Local contrast normalisation. Rescales each pixel against its own
 * neighbourhood so a faint paper/table boundary becomes a strong gradient,
 * without amplifying noise in flat regions.
 *
 * out = 128 + TARGET * (smoothed(p) - localMean(p)) / max(localSpread(p), FLOOR)
 *
 * Both the mean and the spread come from summed-area tables, so the window
 * costs the same whether it is 5px or 50px across: two O(n) prefix passes and
 * four array reads per pixel. A per-pixel window loop would be O(n * window^2),
 * which at 640x480 with a 60px window is ~1e9 reads per frame — unusable in a
 * 10fps loop. The squared-value table is what makes the spread O(1) too.
 *
 * `windowFraction` is the window SIDE as a fraction of the shorter frame side.
 *
 * Three things here are deliberate and each one is load-bearing:
 *
 * 1. The FLOOR on the divisor. In a genuinely flat region — blank paper, an
 *    empty wall — the local spread is the sensor noise and nothing else.
 *    Dividing by it would rescale that noise to full contrast and manufacture
 *    a field of edges out of nothing. The floor caps the gain instead, so flat
 *    regions come out flat.
 *
 * 2. Comparing the SMOOTHED pixel, not the raw pixel, against the local mean.
 *    This is the part that actually fixes white-on-white, and it is worth being
 *    explicit about why, because the obvious version does not work. The
 *    detector's threshold is a percentile (keep the strongest ~8% of pixels),
 *    and a percentile is blind to gain: multiply the whole frame by six and
 *    exactly the same pixels are selected. So a plain normalise-and-amplify
 *    clears the MIN_EDGE_MAGNITUDE floor and changes nothing else — measured,
 *    not assumed. What loses the faint boundary is that the top 8% of a noisy
 *    frame is *filled by noise*, and the only way to win is to improve the
 *    ratio: a 2px box smooth suppresses uncorrelated per-pixel noise while a
 *    paper boundary, being a long coherent step, keeps its amplitude and only
 *    spreads over a few pixels. The cost is corner precision — a smoothed
 *    corner is a rounded corner, worth about a pixel of extra error.
 *
 * 3. Centring on 128. The output is a Uint8ClampedArray, and an edge has a
 *    bright and a dark side; anchoring at either end would clip one of them.
 */
// Half the neighbourhood side, at least 1 so the window is never a single pixel
// (a window of one has zero spread and the output would be a flat 128). Shared
// with the caller's well-conditioning gate so the two cannot drift apart.
function normWindowRadius(w: number, h: number, windowFraction?: number): number {
  const fraction =
    Number.isFinite(windowFraction) && (windowFraction as number) > 0
      ? Math.min(1, Math.max(0.02, windowFraction as number))
      : NORM_WINDOW_FRACTION;
  return Math.max(1, Math.round((Math.min(w, h) * fraction) / 2));
}

export function normaliseLocalContrast(gray: Gray, windowFraction?: number): Gray {
  const w = Math.max(0, gray.width | 0);
  const h = Math.max(0, gray.height | 0);
  const n = w * h;
  const out = new Uint8ClampedArray(n);
  // Malformed frame: a flat map is safer than reading undefined into NaN.
  if (n === 0 || gray.data.length < n) return { data: out, width: w, height: h };

  const src = gray.data;
  const radius = normWindowRadius(w, h, windowFraction);
  const smoothRadius = Math.min(NORM_SMOOTH_RADIUS, radius);

  // Summed-area tables, padded by one row/column of zeros so the four-corner
  // lookup needs no bounds special-casing. Values are integers well inside the
  // exact range of a double (max sum 255 * 640 * 480 ~ 7.8e7, max squared sum
  // ~2.0e10), so these carry no rounding drift.
  const iw = w + 1;
  const sum = new Float64Array(iw * (h + 1));
  const sumSq = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const above = y * iw;
    const here = (y + 1) * iw;
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < w; x++) {
      const v = src[row + x];
      rowSum += v;
      rowSumSq += v * v;
      sum[here + x + 1] = sum[above + x + 1] + rowSum;
      sumSq[here + x + 1] = sumSq[above + x + 1] + rowSumSq;
    }
  }

  for (let y = 0; y < h; y++) {
    const y0 = y - radius < 0 ? 0 : y - radius;
    const y1 = y + radius > h - 1 ? h - 1 : y + radius;
    const sy0 = y - smoothRadius < 0 ? 0 : y - smoothRadius;
    const sy1 = y + smoothRadius > h - 1 ? h - 1 : y + smoothRadius;
    for (let x = 0; x < w; x++) {
      const x0 = x - radius < 0 ? 0 : x - radius;
      const x1 = x + radius > w - 1 ? w - 1 : x + radius;
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const tl = y0 * iw + x0;
      const tr = y0 * iw + x1 + 1;
      const bl = (y1 + 1) * iw + x0;
      const br = (y1 + 1) * iw + x1 + 1;
      const total = sum[br] - sum[tr] - sum[bl] + sum[tl];
      const totalSq = sumSq[br] - sumSq[tr] - sumSq[bl] + sumSq[tl];
      const mean = total / area;
      // E[x^2] - E[x]^2 can go very slightly negative on a constant window
      // through floating point; clamp before the square root.
      const variance = totalSq / area - mean * mean;
      const spread = Math.sqrt(variance > 0 ? variance : 0);

      const sx0 = x - smoothRadius < 0 ? 0 : x - smoothRadius;
      const sx1 = x + smoothRadius > w - 1 ? w - 1 : x + smoothRadius;
      const sArea = (sx1 - sx0 + 1) * (sy1 - sy0 + 1);
      const sTotal =
        sum[(sy1 + 1) * iw + sx1 + 1] -
        sum[sy0 * iw + sx1 + 1] -
        sum[(sy1 + 1) * iw + sx0] +
        sum[sy0 * iw + sx0];
      const centre = sTotal / sArea;

      const divisor = spread > NORM_MIN_SPREAD ? spread : NORM_MIN_SPREAD;
      // Uint8ClampedArray clamps on store; round explicitly so the result does
      // not depend on the engine's half-to-even behaviour.
      out[y * w + x] = Math.round(128 + (NORM_TARGET_SPREAD * (centre - mean)) / divisor);
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Find the most likely document quad in a downscaled grayscale frame.
 * Returns null when nothing convincing is found — returning null is ALWAYS
 * better than returning a wrong quad, because a wrong quad makes the on-screen
 * outline jump around and destroys trust in the feature.
 *
 * Two passes. First the frame as given. Then, ONLY IF that found nothing AND
 * the frame contains no strong edge anywhere, the frame put through
 * normaliseLocalContrast. Adaptive, with both halves of the condition doing
 * real work:
 *
 * - "found nothing" means a frame that already works cannot regress: it never
 *   reaches the second pass, so every previously detected quad comes back bit
 *   for bit. Always-on normalisation would instead run every working detection
 *   through an amplifier it does not need.
 * - "no strong edge anywhere" is what keeps the amplifier out of frames that
 *   were rejected for a REASON. A placemat, a plate, a page running off the
 *   edge of the frame and a page with one side missing are all rejected by
 *   checks that look at structure, and re-running them amplified just gives the
 *   same structure a second chance to slip through — measured: three of those
 *   four rejections flip to a false positive without this half of the gate.
 *   Those frames have plenty of contrast; the amplifier is for the frames that
 *   have none.
 *
 * There is a third condition, on the frame rather than on its content: the
 * normalising window has to be much wider than the smoothing box inside it, or
 * the pass is comparing a pixel against itself and amplifies noise into
 * structure. See NORM_MIN_WINDOW_RATIO. In practice that rules out frames
 * whose shorter side is under 64px; the detection frame the camera UI builds is
 * 256 wide, so this only fires for small callers.
 *
 * The cost is that a genuinely blank frame pays for both passes. Frames with
 * real edges in them — which is most of them, including every frame where the
 * user is actually pointing at something — pay for one.
 */
export function detectQuad(gray: Gray, opts?: DetectOptions): Quad | null {
  const w = gray.width | 0;
  const h = gray.height | 0;
  const n = w * h;
  if (w < MIN_FRAME_SIDE || h < MIN_FRAME_SIDE || gray.data.length < n) {
    return null;
  }
  const stats: PassStats = { strongMagnitude: 0 };
  const direct = detectQuadDirect(gray, opts, stats);
  if (direct !== null) return direct;
  if (stats.strongMagnitude >= NORM_TRIGGER_MAGNITUDE) return null;
  // The frame has to be big enough for the normalising window to mean anything.
  if (normWindowRadius(w, h) < NORM_MIN_WINDOW_RATIO * NORM_SMOOTH_RADIUS) return null;
  return detectQuadDirect(normaliseLocalContrast(gray), opts);
}

// Filled in by the direct pass so detectQuad can decide whether normalising is
// worth trying, without paying for a second Sobel just to measure the frame.
type PassStats = { strongMagnitude: number };

// The pipeline itself, over whatever frame it is handed. Callers go through
// detectQuad, which decides whether that frame needs normalising first.
function detectQuadDirect(
  gray: Gray,
  opts?: DetectOptions,
  stats?: PassStats,
): Quad | null {
  const w = gray.width | 0;
  const h = gray.height | 0;
  const n = w * h;

  const minAreaFraction = clamp01(opts?.minAreaFraction ?? 0.12);
  const maxCornerCosine = clamp01(opts?.maxCornerCosine ?? 0.35);

  const mag = sobelMagnitude(gray);
  const edges = edgeStats(mag);
  if (stats) stats.strongMagnitude = edges.strongMagnitude;
  const threshold = edges.threshold;
  if (threshold === null) return null;

  const edge = new Uint8Array(n);
  let edgeCount = 0;
  for (let i = 0; i < n; i++) {
    if (mag.data[i] >= threshold) {
      edge[i] = 1;
      edgeCount++;
    }
  }
  // Nothing survived thresholding, so there is no boundary to trace. Dense
  // high-frequency texture (a woven placemat, printed halftone) lands here: no
  // threshold isolates a boundary, so the budget walks past the whole histogram.
  if (edgeCount < 16) return null;

  const comp = largestComponent(edge, w, h);
  if (comp === null || comp.length < 16) return null;

  const mask = new Uint8Array(n);
  const pts: Point[] = new Array(comp.length);
  for (let i = 0; i < comp.length; i++) {
    const p = comp[i];
    mask[p] = 1;
    const x = p % w;
    pts[i] = { x, y: (p - x) / w };
  }

  let hull = convexHull(pts);
  if (hull.length < 4) return null;
  if (hull.length > MAX_HULL_VERTICES) hull = subsample(hull, MAX_HULL_VERTICES);

  const poly = decimate(hull, MAX_POLY_VERTICES, COLLINEAR_EPSILON);
  if (poly.length < 4) return null;

  const corners = maxAreaQuad(poly);
  if (corners === null) return null;

  // Deliberately reuse rectify's ordering rather than rolling our own: the quad
  // we emit is fed straight back into rectify, so a second implementation of
  // "which corner is top-left" is a convention drift waiting to happen.
  const quad = orderCorners(corners);
  if (quad === null) return null;

  const area = quadArea(quad);
  if (area < minAreaFraction * n || area > MAX_AREA_FRACTION * n) return null;
  if (!isConvex(quad)) return null;

  const minSide = MIN_SIDE_FRACTION * Math.min(w, h);
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < minSide) return null;
    // Corner i sits between edge (i-1 -> i) and edge (i -> i+1).
    const prev = quad[(i + 3) % 4];
    if (Math.abs(cornerCosine(prev, a, b)) > maxCornerCosine) return null;
  }

  if (!isSupported(quad, mask, w, h)) return null;
  if (!hasStraightSides(quad, mask, w, h)) return null;

  return quad;
}

/**
 * The Sobel magnitude at or above which a pixel counts as an edge in THIS
 * frame, or null when the frame has no gradient worth thresholding.
 *
 * Exported so a caller that wants to ask a second question of the same frame —
 * "is there anything outside the quad I am about to keep?" — uses the
 * detector's own adaptive threshold rather than a second, drifting copy of it.
 */
export function edgeThresholdFor(mag: Gray): number | null {
  return edgeStats(mag).threshold;
}

/** Map a quad from the downscaled detection space back to full-resolution pixels. */
export function scaleQuad(q: Quad, scaleX: number, scaleY: number): Quad {
  return [
    { x: q[0].x * scaleX, y: q[0].y * scaleY },
    { x: q[1].x * scaleX, y: q[1].y * scaleY },
    { x: q[2].x * scaleX, y: q[2].y * scaleY },
    { x: q[3].x * scaleX, y: q[3].y * scaleY },
  ];
}

/** Quad area via the shoelace formula (absolute value). */
export function quadArea(q: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Temporal smoothing so the outline glides instead of jittering.
 * Exponential moving average of corner positions: result = prev*(1-alpha) + next*alpha.
 * If prev is null, returns next unchanged. If the two quads are further apart
 * than `resetDistance` pixels at any corner, snap to `next` instead of easing
 * (the user moved to a different document — easing across that looks broken).
 */
export function smoothQuad(
  prev: Quad | null,
  next: Quad,
  alpha: number,
  resetDistance: number,
): Quad {
  if (prev === null) return next;
  for (let i = 0; i < 4; i++) {
    const dx = next[i].x - prev[i].x;
    const dy = next[i].y - prev[i].y;
    if (Math.hypot(dx, dy) > resetDistance) return next;
  }
  // Out-of-range alpha would overshoot the target and make the outline wobble.
  const a = clamp01(alpha);
  const ease = (i: number): Point => ({
    x: prev[i].x * (1 - a) + next[i].x * a,
    y: prev[i].y * (1 - a) + next[i].y * a,
  });
  return [ease(0), ease(1), ease(2), ease(3)];
}

/* -------------------------------------------------------------- internals --- */

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}

// Smallest threshold that keeps the edge pixel count inside the budget. Returns
// null when the frame has no gradient worth thresholding at all (flat field).
// The budget formulation is what makes this adaptive: a frame of uniform
// gradient magnitude (a smooth ramp) can never fit inside the budget, so the
// threshold walks past its single histogram bin and the edge map comes out
// empty — exactly the "no document here" answer we want.
// Also reports `strongMagnitude`: the magnitude at the top NORM_TRIGGER_FRACTION
// of pixels, i.e. "how strong is the strongest real structure in this frame".
// It rides along here because the histogram is already built.
function edgeStats(mag: Gray): { threshold: number | null; strongMagnitude: number } {
  const n = mag.width * mag.height;
  const hist = new Int32Array(256);
  let maxMag = 0;
  for (let i = 0; i < n; i++) {
    const v = mag.data[i];
    hist[v]++;
    if (v > maxMag) maxMag = v;
  }

  // Walk down from the top until we have covered the strongest
  // NORM_TRIGGER_FRACTION of pixels (0.25%).
  const strongCount = Math.max(1, Math.floor(n * NORM_TRIGGER_FRACTION));
  let seen = 0;
  let strongMagnitude = 0;
  for (let v = 255; v >= 0; v--) {
    seen += hist[v];
    if (seen >= strongCount) {
      strongMagnitude = v;
      break;
    }
  }

  if (maxMag < MIN_EDGE_MAGNITUDE) return { threshold: null, strongMagnitude };

  const budget = Math.max(
    Math.floor(n * EDGE_BUDGET_FRACTION),
    EDGE_BUDGET_PERIMETER_MULTIPLE * (mag.width + mag.height),
  );
  let count = 0;
  let t = 0;
  for (let v = 255; v >= 0; v--) {
    count += hist[v];
    if (count > budget) {
      t = v + 1;
      break;
    }
    t = v;
  }
  // A threshold above the strongest pixel in the frame is not a bug: it means
  // no level of thresholding isolates a boundary here, the caller finds an empty
  // edge map, and the answer is "no document".
  return { threshold: Math.max(t, MIN_EDGE_MAGNITUDE), strongMagnitude };
}

// Largest 8-connected component of the edge map, as pixel indices. Iterative
// flood fill — a recursive one blows the stack on a long document edge.
function largestComponent(
  edge: Uint8Array,
  w: number,
  h: number,
): number[] | null {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best: number[] | null = null;
  for (let start = 0; start < n; start++) {
    if (edge[start] === 0 || seen[start] === 1) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const comp: number[] = [];
    while (sp > 0) {
      const p = stack[--sp];
      comp.push(p);
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (edge[q] === 1 && seen[q] === 0) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    if (best === null || comp.length > best.length) best = comp;
  }
  return best;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Andrew's monotone chain. Output winds consistently; the caller normalises.
function convexHull(points: readonly Point[]): Point[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  const lower: Point[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function subsample(poly: readonly Point[], target: number): Point[] {
  const out: Point[] = [];
  const step = poly.length / target;
  for (let i = 0; i < target; i++) out.push(poly[Math.floor(i * step)]);
  return out;
}

// Perpendicular distance from p to the line through a and b.
function lineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
}

// Drop the vertex that matters least, repeatedly. On a convex polygon this is
// equivalent to Douglas-Peucker but targets a vertex COUNT directly, so there
// is no epsilon to binary-search: it stops as soon as the cheapest remaining
// vertex is a real corner rather than rasterisation staircase.
function decimate(
  poly: readonly Point[],
  maxVertices: number,
  collinearEps: number,
): Point[] {
  const out = poly.slice();
  while (out.length > 4) {
    let worstIdx = -1;
    let worstErr = Infinity;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const next = out[(i + 1) % out.length];
      const err = lineDistance(out[i], prev, next);
      if (err < worstErr) {
        worstErr = err;
        worstIdx = i;
      }
    }
    if (worstIdx < 0) break;
    if (out.length <= maxVertices && worstErr > collinearEps) break;
    out.splice(worstIdx, 1);
  }
  return out;
}

function triangleArea2(a: Point, b: Point, c: Point): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

// Largest-area quadrilateral inscribed in a convex polygon. For a rectangle (or
// a perspective-warped one) that is exactly its four corners, and unlike a
// simplification threshold it always returns four points or nothing.
function maxAreaQuad(poly: readonly Point[]): Point[] | null {
  const n = poly.length;
  if (n < 4) return null;
  if (n === 4) return poly.slice();
  let best: Point[] | null = null;
  let bestArea = 0;
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        const left = triangleArea2(poly[a], poly[b], poly[c]);
        for (let d = c + 1; d < n; d++) {
          const area = left + triangleArea2(poly[a], poly[c], poly[d]);
          if (area > bestArea) {
            bestArea = area;
            best = [poly[a], poly[b], poly[c], poly[d]];
          }
        }
      }
    }
  }
  return bestArea > 0 ? best : null;
}

// Postcondition, not a filter: four vertices taken in order from a convex hull
// are always convex, so this cannot currently fire. It is kept because it is the
// one check standing between a future change to the candidate generator and a
// bow-tie quad reaching the UI, which would render as a visibly broken outline.
function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const z = cross(a, b, c);
    if (z === 0) return false; // three corners in a line: not a document
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// Cosine of the angle at `corner` between the two sides meeting there.
function cornerCosine(prev: Point, corner: Point, next: Point): number {
  const ax = prev.x - corner.x;
  const ay = prev.y - corner.y;
  const bx = next.x - corner.x;
  const by = next.y - corner.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return 1;
  return (ax * bx + ay * by) / (la * lb);
}

function hasEdgeNear(
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number = SUPPORT_RADIUS,
): boolean {
  const x0 = clampInt(Math.round(x) - radius, 0, w - 1);
  const x1 = clampInt(Math.round(x) + radius, 0, w - 1);
  const y0 = clampInt(Math.round(y) - radius, 0, h - 1);
  const y1 = clampInt(Math.round(y) + radius, 0, h - 1);
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w;
    for (let xx = x0; xx <= x1; xx++) if (mask[row + xx] === 1) return true;
  }
  return false;
}

// Does each side of the candidate actually lie on edge pixels of the component
// it came from? A real document boundary is covered along all four sides; the
// convex hull of a sparse noise cluster is mostly empty space, which is what
// this rejects.
function isSupported(q: Quad, mask: Uint8Array, w: number, h: number): boolean {
  let hits = 0;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const samples = Math.max(8, Math.ceil(len / 2));
    let sideHits = 0;
    for (let s = 0; s < samples; s++) {
      const t = (s + 0.5) / samples;
      if (hasEdgeNear(mask, w, h, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) {
        sideHits++;
      }
    }
    if (sideHits / samples < MIN_SIDE_SUPPORT) return false;
    hits += sideHits;
    total += samples;
  }
  return total > 0 && hits / total >= MIN_TOTAL_SUPPORT;
}

// Signed distance from (x, y) to the OUTERMOST edge pixel of the component
// along the line through (nx, ny) — positive on the (nx, ny) side. Null when
// the whole band is empty. The walk starts at the far end of the band and
// returns the first hit, so what it finds is the component's silhouette rather
// than the near surface of a thick boundary; see hasStraightSides for why that
// distinction is the whole measurement. Half-pixel steps because the mask is a
// pixel grid and a whole-pixel walk along a diagonal normal skips cells. Uses
// the support check's own lookup, at radius 0: this measures a distance, and a
// 5x5 probe would smear every offset by 2px in both directions.
function outerBoundaryOffset(
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
  band: number,
): number | null {
  for (let d = band; d >= -band; d -= 0.5) {
    if (hasEdgeNear(mask, w, h, x + nx * d, y + ny * d, 0)) return d;
  }
  return null;
}

// Median of up to three values, ignoring the ones that could not be measured.
// Null when nothing was measured.
function median3(a: number | null, b: number | null, c: number | null): number | null {
  const vs: number[] = [];
  if (a !== null) vs.push(a);
  if (b !== null) vs.push(b);
  if (c !== null) vs.push(c);
  if (vs.length === 0) return null;
  vs.sort((p, r) => p - r);
  return vs[vs.length >> 1];
}

/**
 * Are the candidate's sides STRAIGHT, or do they bow?
 *
 * This is a different question from support, and the difference is the whole
 * point of the check. isSupported asks "is there an edge pixel within 2px of
 * this side", and the arc of a large round object answers YES over enough of
 * its length to pass: a plate, a bowl, a circular shadow, a pool of lamp light.
 * Each of those then gets a quadrilateral inscribed in its rim by a candidate
 * generator whose whole job is to maximise area, and every remaining check —
 * area, convexity, 90-degree corners, support — is satisfied by that square.
 *
 * The discriminator is geometric and does not assume the shape is a circle. A
 * rectangle's boundary lies ON the chord between two adjacent corners. A convex
 * curve's boundary bows AWAY from it, and for a quad inscribed in a circle the
 * bow at mid-side is ~0.207 of the side length: a fifth of the side, not a
 * rounding error.
 *
 * Method, per side:
 *
 *  1. Take the outward normal (away from the quad's centre).
 *  2. At each of nine sample points along the side, find the component's OUTER
 *     SILHOUETTE along that normal — the furthest-out edge pixel within the
 *     band, signed, positive meaning outside the chord.
 *  3. Score the middle of the side against its own ends:
 *
 *       bow = median(silhouette at t = 0.425, 0.5, 0.575)
 *             - mean(silhouette at t = 0.2, 0.8)
 *
 * Both of those choices were forced by measurement, and the naive version of
 * each fails:
 *
 * - NEAREST edge pixel instead of the outer silhouette saturates. The
 *   thresholded boundary is a ring, and a soft-rimmed object's ring is thick;
 *   once it is thicker than the sagitta it covers the chord along the entire
 *   side and the bow measures as ~0. Measured: nearest-hit leaves 57 of 960
 *   soft round objects detected, all of them at the soft end. The silhouette
 *   does not saturate, because a thick ring's OUTER surface still follows the
 *   arc.
 * - Scoring against the chord (i.e. against zero) instead of against the ends
 *   does not separate the classes at all. A page whose corners are rounded, or
 *   whose corner estimate is a pixel out, carries a standing offset along a
 *   perfectly straight side; measured raw offsets of a real page and of a plate
 *   overlap. Curvature is what distinguishes them: a standing offset cancels,
 *   an arch that rises in the middle and returns to nothing at both ends does
 *   not.
 *
 * Median in the middle rather than mean, so one sample landing on a speck of
 * texture cannot condemn a real page. Everything is expressed in the side's own
 * frame — a chord parameter and a normal — so the measure is rotation invariant
 * by construction, and the allowance is a fraction of the side, so it is scale
 * invariant too.
 *
 * A side whose middle or whose ends cannot be measured at all abstains rather
 * than failing: "this side has no boundary under it" is isSupported's question,
 * and it has already been asked.
 */
function hasStraightSides(q: Quad, mask: Uint8Array, w: number, h: number): boolean {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return false;
    // Unit normal, flipped to point away from the quad's centre so that a
    // positive offset always means "outside the candidate".
    let nx = -dy / len;
    let ny = dx / len;
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const band = Math.max(STRAIGHT_BAND_MIN, STRAIGHT_BAND_FRACTION * len);

    const devs: Array<number | null> = new Array(STRAIGHT_SAMPLES);
    for (let s = 0; s < STRAIGHT_SAMPLES; s++) {
      const t = STRAIGHT_T0 + ((STRAIGHT_T1 - STRAIGHT_T0) * s) / (STRAIGHT_SAMPLES - 1);
      devs[s] = outerBoundaryOffset(mask, w, h, a.x + dx * t, a.y + dy * t, nx, ny, band);
    }

    const mid = STRAIGHT_SAMPLES >> 1;
    const centre = median3(devs[mid - 1], devs[mid], devs[mid + 1]);
    const head = devs[0];
    const tail = devs[STRAIGHT_SAMPLES - 1];
    if (centre === null || head === null || tail === null) continue;

    const bow = centre - (head + tail) / 2;
    if (bow > Math.max(STRAIGHT_MIN_BOW, STRAIGHT_MAX_BOW_FRACTION * len)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Outline stability — kills the border snapping back and forth.
// ---------------------------------------------------------------------------

/** Largest corner-to-corner distance between two quads. */
function maxCornerDistance(a: Quad, b: Quad): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    if (d > worst) worst = d;
  }
  return worst;
}

export type QuadStability = {
  /** The quad the outline is actually showing. */
  shown: Quad | null;
  /** A far-away detection waiting to prove it is real, and for how long. */
  candidate: Quad | null;
  candidateRuns: number;
};

export const INITIAL_QUAD_STABILITY: QuadStability = {
  shown: null,
  candidate: null,
  candidateRuns: 0,
};

/**
 * Temporal hysteresis on top of smoothQuad, because easing alone cannot fix
 * ALTERNATION. On a real phone the detector sometimes flips between two rival
 * readings of the same scene (page vs page-plus-shadow, or two corner
 * placements), and an ease-or-snap rule faithfully chases every flip — which
 * the founder saw as the border "snapping back and forth".
 *
 * The rule here: a detection NEAR the shown outline glides it (smoothQuad); a
 * detection FAR from it is treated as a claim, not a fact — the outline holds
 * still until the new position repeats for `adoptAfter` consecutive frames.
 * A one-frame outlier moves nothing. A genuine repositioning is adopted after
 * ~3 frames, which at 20fps is invisible. And an A/B/A/B alternation never
 * accumulates a run, so the outline simply stays put on A.
 */
export function stabiliseQuad(
  prev: QuadStability,
  next: Quad | null,
  opts: { alpha: number; jumpDistance: number; adoptAfter: number },
): QuadStability {
  // No detection this frame: hold what is shown (the caller's grace window
  // decides when it disappears) and forget any half-proven candidate.
  if (!next) return { shown: prev.shown, candidate: null, candidateRuns: 0 };

  const { shown } = prev;
  if (!shown) return { shown: next, candidate: null, candidateRuns: 0 };

  if (maxCornerDistance(shown, next) <= opts.jumpDistance) {
    // Same position, small drift — glide. Infinity disables smoothQuad's own
    // snap; this function owns the far-jump policy now.
    return {
      shown: smoothQuad(shown, next, opts.alpha, Number.POSITIVE_INFINITY),
      candidate: null,
      candidateRuns: 0,
    };
  }

  const sameCandidate =
    prev.candidate !== null &&
    maxCornerDistance(prev.candidate, next) <= opts.jumpDistance;
  const candidateRuns = sameCandidate ? prev.candidateRuns + 1 : 1;

  if (candidateRuns >= opts.adoptAfter) {
    return { shown: next, candidate: null, candidateRuns: 0 };
  }
  return { shown, candidate: next, candidateRuns };
}
