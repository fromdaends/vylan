import { describe, it, expect } from "vitest";
import { advanceHint, INITIAL_HINT, type HintState } from "./hint-visibility";
import type { Guidance } from "./frame-metrics";

const OPTS = { settleMs: 400, lingerMs: 1800, cooldownMs: 6000 };
const DT = 50;

/** Run a guidance sequence and collect what was on screen each frame. */
function run(frames: Guidance[], dt = DT) {
  let state: HintState = INITIAL_HINT;
  return frames.map((guidance) => {
    const step = advanceHint(state, { guidance, elapsedMs: dt, ...OPTS });
    state = step.state;
    return step.visible;
  });
}

function times(n: number, g: Guidance): Guidance[] {
  return Array.from({ length: n }, () => g);
}

describe("advanceHint — saying less", () => {
  it("never shows 'ready' — the outline and the ring already say it", () => {
    // This alone removes the text from the common case, which is most of what
    // "appear less often" means in practice.
    expect(run(times(200, "ready")).every((v) => v === null)).toBe(true);
  });

  it("waits for a hint to settle before giving it the screen", () => {
    const shown = run(times(20, "too_dark"));
    // 400ms of settle at 50ms/frame = nothing for the first 8 frames.
    expect(shown.slice(0, 8).every((v) => v === null)).toBe(true);
    expect(shown[8]).toBe("too_dark");
  });

  it("ignores a metric flickering across its threshold", () => {
    // Alternating advice never accumulates settle time, so nothing is said —
    // this is the strobing text the change exists to prevent.
    const flicker = Array.from({ length: 60 }, (_, i) =>
      i % 2 === 0 ? ("too_dark" as Guidance) : ("hold_steady" as Guidance),
    );
    expect(run(flicker).every((v) => v === null)).toBe(true);
  });

  it("pops up, then disappears on its own while the condition persists", () => {
    const shown = run(times(80, "too_far"));
    const first = shown.indexOf("too_far");
    const gone = shown.indexOf(null, first);
    expect(first).toBeGreaterThan(-1);
    expect(gone).toBeGreaterThan(first);
    // Visible for the linger window, not forever.
    expect((gone - first) * DT).toBeGreaterThanOrEqual(OPTS.lingerMs);
    expect((gone - first) * DT).toBeLessThanOrEqual(OPTS.lingerMs + DT * 2);
  });

  it("does not repeat the same hint until its cooldown expires", () => {
    // 8s of an unchanging condition: shown once, then silence — not a nag
    // every couple of seconds.
    const shown = run(times(160, "too_far"));
    const appearances = shown.filter(
      (v, i) => v === "too_far" && shown[i - 1] !== "too_far",
    ).length;
    expect(appearances).toBe(1);
  });

  it("lets a DIFFERENT hint through while another is cooling down", () => {
    const seq: Guidance[] = [
      ...times(60, "too_far"), // shows, then hides, then cools
      ...times(20, "too_dark"), // a genuinely new problem must still speak
    ];
    const shown = run(seq);
    expect(shown).toContain("too_far");
    expect(shown).toContain("too_dark");
  });

  it("shows the same hint again once enough time has passed", () => {
    const seq: Guidance[] = [
      ...times(50, "too_dark"),
      ...times(140, "searching"), // long enough to clear the cooldown
      ...times(20, "too_dark"),
    ];
    const shown = run(seq);
    const appearances = shown.filter(
      (v, i) => v === "too_dark" && shown[i - 1] !== "too_dark",
    ).length;
    expect(appearances).toBe(2);
  });
});

describe("advanceHint — robustness", () => {
  it("measures in real time, not frames", () => {
    const slow = run(times(40, "too_dark"), 100).indexOf("too_dark");
    const fast = run(times(80, "too_dark"), 25).indexOf("too_dark");
    expect(slow * 100).toBe(OPTS.settleMs);
    expect(fast * 25).toBe(OPTS.settleMs);
  });

  it("treats a huge timing gap as one ordinary step", () => {
    const step = advanceHint(INITIAL_HINT, {
      guidance: "too_dark",
      elapsedMs: 30_000,
      ...OPTS,
    });
    expect(step.visible).toBeNull();
    expect(step.state.pendingMs).toBeLessThanOrEqual(250);
  });

  it("ignores a non-finite or negative interval", () => {
    for (const elapsedMs of [NaN, Infinity, -100, 0]) {
      const step = advanceHint(
        { ...INITIAL_HINT, pending: "too_dark", pendingMs: 100 },
        { guidance: "too_dark", elapsedMs, ...OPTS },
      );
      expect(step.state.pendingMs).toBe(100);
      expect(Number.isFinite(step.state.pendingMs)).toBe(true);
    }
  });

  it("does not mutate the state it is given", () => {
    const prev: HintState = {
      visible: null,
      visibleMs: 0,
      pending: "too_dark",
      pendingMs: 100,
      lastShownAgoMs: { too_far: 500 },
    };
    const snapshot = JSON.parse(JSON.stringify(prev));
    advanceHint(prev, { guidance: "too_dark", elapsedMs: DT, ...OPTS });
    expect(JSON.parse(JSON.stringify(prev))).toEqual(snapshot);
  });
});
