// Motion effect budget for the marketing hero — how expensive an effect the
// visitor's browser can actually afford to paint.
//
// WHY THIS EXISTS. The hero reel's word swap animates `filter: blur(120px)`.
// That is a large GPU raster, and on a machine running in a power/performance
// mode (Opera GX's CPU limiter, a laptop on battery saver, an old phone) the
// browser drops the frames that carry the blur, so the effect either stutters
// or never appears. Rather than guess, this module picks a BUDGET and then
// checks the guess against real measured frame times.
//
// THIS IS NOT THE REDUCED-MOTION SWITCH. Motion preference (does the visitor
// want movement?) and effect budget (can the device paint it?) are separate
// axes and compose in CSS:
//   * `prefers-reduced-motion: reduce` zeroes the drift distances — no
//     movement, for accessibility. It does NOT remove the blur: a blur
//     cross-dissolve on a text element that never moves is not a vestibular
//     trigger, and stripping it (the old behaviour) left every reduced-motion
//     visitor with a flat opacity cut.
//   * The tier below scales the blur radius (and drift) to what the device can
//     paint. `plain` is the only state with no blur at all.
// Both are expressed as CSS custom properties, so the accessible default holds
// even if this module never runs.

export type MotionTier = "full" | "soft" | "plain";

// Ordered cheapest-last. `downgrade` walks this and never walks back.
const LADDER: MotionTier[] = ["full", "soft", "plain"];

export type MotionSignals = {
  // navigator.connection.saveData — an explicit "give me the lean version".
  saveData: boolean;
  // navigator.deviceMemory (GB, coarse) — absent outside Chromium.
  deviceMemoryGb: number | null;
  // navigator.hardwareConcurrency — absent on very old browsers.
  cores: number | null;
};

// Static thresholds, deliberately conservative: they only exist so the FIRST
// transition isn't the one that stutters. The measured check below is the real
// signal and can still downgrade a device that looked capable on paper.
// Tunable — nothing else depends on these numbers.
const MIN_MEMORY_GB_FOR_BLUR = 1.5; // ≤1GB devices get no blur at all
const WEAK_MEMORY_GB = 2; // ≤2GB → cheap blur only
const WEAK_CORES = 2; // ≤2 cores → cheap blur only

export function initialTier(s: MotionSignals): MotionTier {
  if (s.deviceMemoryGb != null && s.deviceMemoryGb < MIN_MEMORY_GB_FOR_BLUR) {
    return "plain";
  }
  if (
    s.saveData ||
    (s.deviceMemoryGb != null && s.deviceMemoryGb <= WEAK_MEMORY_GB) ||
    (s.cores != null && s.cores <= WEAK_CORES)
  ) {
    return "soft";
  }
  return "full";
}

export function downgrade(tier: MotionTier): MotionTier {
  const i = LADDER.indexOf(tier);
  return LADDER[Math.min(i + 1, LADDER.length - 1)] as MotionTier;
}

export type FrameSample = {
  frames: number;
  meanMs: number;
  worstMs: number;
};

// A transition lasts ~0.5s, so a healthy sample is ~30 frames at 60Hz and ~15
// at 30Hz. Below this we don't have enough evidence to judge anything.
const MIN_FRAMES_TO_JUDGE = 6;

// PURE: fold raw inter-frame deltas into a verdict-ready summary. The FIRST
// delta is dropped — it measures how long the browser took to schedule the
// first callback, not how long a frame took to paint.
export function summarizeFrames(deltas: number[]): FrameSample | null {
  const usable = deltas.slice(1).filter((d) => Number.isFinite(d) && d > 0);
  if (usable.length < MIN_FRAMES_TO_JUDGE) return null;
  let total = 0;
  let worst = 0;
  for (const d of usable) {
    total += d;
    if (d > worst) worst = d;
  }
  return {
    frames: usable.length,
    meanMs: total / usable.length,
    worstMs: worst,
  };
}

// Sustained slowness (below ~31fps on average) or one visible hitch. A single
// long frame is enough: at this size a 120ms stall reads as the animation
// "jumping", which is exactly the complaint this module answers.
const JANK_MEAN_MS = 32;
const JANK_WORST_MS = 120;

export function isJanky(s: FrameSample): boolean {
  return s.meanMs > JANK_MEAN_MS || s.worstMs > JANK_WORST_MS;
}

// PURE: the tier to use after watching a transition. Never upgrades — a device
// that stuttered once keeps the cheaper effect for the rest of the session,
// because flapping between budgets looks worse than either budget.
export function tierAfterSample(
  current: MotionTier,
  sample: FrameSample | null,
): MotionTier {
  if (!sample) return current;
  return isJanky(sample) ? downgrade(current) : current;
}

export function isMotionTier(v: unknown): v is MotionTier {
  return v === "full" || v === "soft" || v === "plain";
}

// `?motion=` — the diagnostic seam. `?motion=debug` shows the live readout;
// `?motion=full|soft|plain` forces a budget AND shows the readout, so a
// visitor can prove on their own machine whether a missing blur is their
// motion setting or their hardware. Anything else is ignored.
export function parseMotionParam(raw: string | null): {
  forced: MotionTier | null;
  debug: boolean;
} {
  const v = (raw ?? "").trim().toLowerCase();
  if (isMotionTier(v)) return { forced: v, debug: true };
  if (v === "debug") return { forced: null, debug: true };
  return { forced: null, debug: false };
}

// Session-scoped so a downgrade survives navigation between marketing pages
// without freezing the visitor's experience forever (a new tab re-measures).
const STORAGE_KEY = "vy-motion-tier";

export function readStoredTier(): MotionTier | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return isMotionTier(v) ? v : null;
  } catch {
    // Storage disabled (Safari private mode, embedded webviews) — just measure
    // again on this page.
    return null;
  }
}

export function storeTier(tier: MotionTier): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, tier);
  } catch {
    // Non-fatal: the tier still applies for this page.
  }
}

// Read the browser's capability hints. Both properties are Chromium-only, so
// every absent value stays null and simply doesn't vote.
export function readMotionSignals(): MotionSignals {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return {
    saveData: nav.connection?.saveData === true,
    deviceMemoryGb:
      typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cores:
      typeof nav.hardwareConcurrency === "number"
        ? nav.hardwareConcurrency
        : null,
  };
}
