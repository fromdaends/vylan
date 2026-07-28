import { describe, it, expect } from "vitest";
import {
  advanceShutter,
  INITIAL_SHUTTER,
  type ShutterState,
} from "./auto-shutter";
import type { Guidance } from "./frame-metrics";

const GRACE_MS = 300;
const REQUIRED_MS = 500;

type Frame = { detected: boolean; guidance: Guidance; dt?: number };

/** Run a sequence of frames at a given interval and collect every step. */
function run(frames: Frame[], dt = 50) {
  let state: ShutterState = INITIAL_SHUTTER;
  return frames.map((f) => {
    const step = advanceShutter(state, {
      detected: f.detected,
      guidanceFor: () => f.guidance,
      elapsedMs: f.dt ?? dt,
      graceMs: GRACE_MS,
      requiredReadyMs: REQUIRED_MS,
    });
    state = step.state;
    return step;
  });
}

const good: Frame = { detected: true, guidance: "ready" };
const framedButOff: Frame = { detected: true, guidance: "too_far" };
const wobble: Frame = { detected: true, guidance: "hold_steady" };
const miss: Frame = { detected: false, guidance: "searching" };

function times(n: number, f: Frame): Frame[] {
  return Array.from({ length: n }, () => f);
}

describe("advanceShutter — firing on accumulated good time", () => {
  it("fires once the required good time has accrued, not before", () => {
    // 500ms required, 50ms frames -> the 10th good frame.
    const steps = run(times(10, good));
    expect(steps.slice(0, 9).some((s) => s.fire)).toBe(false);
    expect(steps[9]!.fire).toBe(true);
  });

  it("fires after the same REAL time regardless of frame rate", () => {
    // This is the whole reason the reducer counts milliseconds. Counting
    // frames meant changing the loop's speed silently retuned the shutter.
    const slow = run(times(20, good), 100).findIndex((s) => s.fire);
    const fast = run(times(40, good), 25).findIndex((s) => s.fire);
    expect((slow + 1) * 100).toBe(500);
    expect((fast + 1) * 25).toBe(500);
  });

  it("survives a single marginal frame instead of starting over", () => {
    // The bug that stopped it firing on a real phone: four metrics flickering
    // around their thresholds meant one bad frame wiped the whole run, and a
    // hand-held client never strung together six clean ones.
    const steps = run([...times(9, good), wobble, ...times(3, good)]);
    expect(steps.some((s) => s.fire)).toBe(true);
  });

  it("costs more than it earned, so nearly-steady never creeps to the line", () => {
    // Alternating good/bad must NOT accumulate: the drain is 1.5x the gain.
    const steps = run(times(40, good).flatMap((g) => [g, wobble]));
    expect(steps.some((s) => s.fire)).toBe(false);
  });

  it("never fires while the document is framed but not yet good", () => {
    expect(run(times(40, framedButOff)).some((s) => s.fire)).toBe(false);
  });

  it("never fires when no document was found at all", () => {
    expect(run(times(40, miss)).some((s) => s.fire)).toBe(false);
  });

  it("spends the credit on firing, so it does not burst", () => {
    const fires = run(times(30, good)).filter((s) => s.fire).length;
    // 30 frames x 50ms = 1500ms of good time; at 500ms a shot with a reset
    // after each, that is exactly 3 — not 21.
    expect(fires).toBe(3);
  });

  it("drains faster when the document is lost than when it is merely off", () => {
    const afterWobble = run([...times(8, good), wobble]).at(-1)!.state.readyMs;
    const afterMiss = run([...times(8, good), miss]).at(-1)!.state.readyMs;
    expect(afterMiss).toBeLessThan(afterWobble);
  });

  it("never lets credit go negative", () => {
    const steps = run(times(20, miss));
    expect(steps.every((s) => s.state.readyMs >= 0)).toBe(true);
  });
});

describe("advanceShutter — progress", () => {
  it("climbs from 0 to 1 as the good time accrues", () => {
    const steps = run(times(10, good));
    expect(steps[0]!.progress).toBeCloseTo(0.1, 5);
    expect(steps[4]!.progress).toBeCloseTo(0.5, 5);
    expect(steps[9]!.progress).toBe(1);
  });

  it("stays within 0..1 even on a nonsense requirement", () => {
    const step = advanceShutter(INITIAL_SHUTTER, {
      detected: true,
      guidanceFor: () => "ready",
      elapsedMs: 50,
      graceMs: GRACE_MS,
      requiredReadyMs: 0,
    });
    expect(step.progress).toBeGreaterThanOrEqual(0);
    expect(step.progress).toBeLessThanOrEqual(1);
    // A zero requirement must not mean "fire immediately".
    expect(step.fire).toBe(false);
  });
});

describe("advanceShutter — outline persistence", () => {
  it("holds the outline through a short gap then clears it", () => {
    const steps = run([good, ...times(8, miss)]);
    expect(steps[1]!.outline).toBe("hold");
    expect(steps.at(-1)!.outline).toBe("clear");
  });

  it("holds for the grace period in real time, not in frames", () => {
    // Both rates must clear on the first tick PAST the grace window — so the
    // elapsed time at that tick sits within one interval of it, whatever the
    // loop's speed. (Counting frames instead gave 2x the hold at half the rate.)
    for (const dt of [25, 50, 100]) {
      const idx = run([good, ...times(40, miss)], dt).findIndex(
        (s) => s.outline === "clear",
      );
      expect(idx).toBeGreaterThan(0);
      const elapsed = idx * dt;
      expect(elapsed).toBeGreaterThan(GRACE_MS);
      expect(elapsed).toBeLessThanOrEqual(GRACE_MS + dt);
    }
  });

  it("resets the miss clock as soon as the document reappears", () => {
    const steps = run([good, miss, miss, good, miss]);
    expect(steps[3]!.state.missMs).toBe(0);
    expect(steps[4]!.outline).toBe("hold");
  });

  it("clears immediately when there was never anything to hold", () => {
    const steps = run(times(10, miss));
    expect(steps.at(-1)!.outline).toBe("clear");
    expect(steps.at(-1)!.documentPresent).toBe(false);
  });
});

describe("advanceShutter — hostile timing", () => {
  it("treats a huge gap as one ordinary step", () => {
    // A backgrounded tab, a stalled decode or a paused debugger can hand us
    // seconds. Crediting all of it would fire on a frame nobody was looking at.
    const step = advanceShutter(
      { readyMs: 400, missMs: 0 },
      {
        detected: true,
        guidanceFor: () => "ready",
        elapsedMs: 30_000,
        graceMs: GRACE_MS,
        requiredReadyMs: REQUIRED_MS,
      },
    );
    expect(step.state.readyMs).toBeLessThanOrEqual(400 + 250);
  });

  it("ignores a non-finite or negative interval rather than corrupting state", () => {
    for (const elapsedMs of [NaN, Infinity, -100, 0]) {
      const step = advanceShutter(
        { readyMs: 200, missMs: 0 },
        {
          detected: true,
          guidanceFor: () => "ready",
          elapsedMs,
          graceMs: GRACE_MS,
          requiredReadyMs: REQUIRED_MS,
        },
      );
      expect(Number.isFinite(step.state.readyMs)).toBe(true);
      expect(step.state.readyMs).toBe(200);
    }
  });

  it("does not mutate the state it is given", () => {
    const prev: ShutterState = { readyMs: 120, missMs: 40 };
    const snapshot = { ...prev };
    advanceShutter(prev, {
      detected: true,
      guidanceFor: () => "ready",
      elapsedMs: 50,
      graceMs: GRACE_MS,
      requiredReadyMs: REQUIRED_MS,
    });
    expect(prev).toEqual(snapshot);
  });
});
