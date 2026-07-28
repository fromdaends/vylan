import { describe, it, expect } from "vitest";
import {
  advanceShutter,
  INITIAL_SHUTTER,
  type ShutterState,
} from "./auto-shutter";
import type { Guidance } from "./frame-metrics";

const GRACE_MS = 350;
const REQUIRED_MS = 600;

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
      requiredDetectedMs: REQUIRED_MS,
    });
    state = step.state;
    return step;
  });
}

const good: Frame = { detected: true, guidance: "ready" };
// Detected, but every quality hint failing — a shaky hand in a dim kitchen.
const shaky: Frame = { detected: true, guidance: "hold_steady" };
const dark: Frame = { detected: true, guidance: "too_dark" };
const blurry: Frame = { detected: true, guidance: "blurry" };
const miss: Frame = { detected: false, guidance: "searching" };

function times(n: number, f: Frame): Frame[] {
  return Array.from({ length: n }, () => f);
}

describe("advanceShutter — detection is the ONLY gate", () => {
  it("fires for a shaky hand: quality hints must not block the shutter", () => {
    // The founder's requirement, verbatim: "once there's a document detected
    // in the frame, even if the camera is shaky it still takes a picture."
    // Guidance says hold_steady on EVERY frame here; it must fire anyway.
    const steps = run(times(20, shaky));
    expect(steps.some((s) => s.fire)).toBe(true);
    // 600ms at 50ms/frame = the 12th frame.
    expect(steps.findIndex((s) => s.fire)).toBe(11);
  });

  it("fires in the dark and fires when blurry — advice never gates", () => {
    expect(run(times(20, dark)).some((s) => s.fire)).toBe(true);
    expect(run(times(20, blurry)).some((s) => s.fire)).toBe(true);
  });

  it("fires after the same REAL time regardless of frame rate", () => {
    const slow = run(times(20, good), 100).findIndex((s) => s.fire);
    const fast = run(times(40, good), 25).findIndex((s) => s.fire);
    expect((slow + 1) * 100).toBe(REQUIRED_MS);
    expect((fast + 1) * 25).toBe(REQUIRED_MS);
  });

  it("never fires without a document", () => {
    expect(run(times(60, miss)).some((s) => s.fire)).toBe(false);
  });

  it("does not fire on a swing-past", () => {
    // A camera sweeping across a document sees it briefly, loses it for
    // longer than the grace window, sees another. No single run reaches the
    // requirement, so nothing fires.
    const sweep = [
      ...times(4, good), // 200ms
      ...times(9, miss), // 450ms > grace, credit resets
      ...times(4, good),
      ...times(9, miss),
      ...times(4, good),
    ];
    expect(run(sweep).some((s) => s.fire)).toBe(false);
  });
});

describe("advanceShutter — shake dropouts do not restart the count", () => {
  it("holds the credit through a short dropout and still fires", () => {
    // Shake blurs the frame and detection drops for a moment. The credit must
    // HOLD through the grace window — draining here was exactly what made a
    // shaky hand unable to fire.
    const steps = run([
      ...times(8, shaky), // 400ms of credit
      ...times(4, miss), // 200ms dropout, inside the 350ms grace
      ...times(8, shaky), // credit resumes at 400ms
    ]);
    expect(steps.some((s) => s.fire)).toBe(true);
    // Fires on the 4th frame after the dropout: 400 + 200 = 600ms of credit.
    expect(steps.findIndex((s) => s.fire)).toBe(15);
  });

  it("keeps the credit frozen, not accruing, during the dropout", () => {
    const steps = run([...times(8, good), ...times(4, miss)]);
    expect(steps.at(-1)!.state.detectedMs).toBe(400);
  });

  it("starts over once the document is genuinely gone", () => {
    const steps = run([...times(8, good), ...times(9, miss), good]);
    // 450ms of misses exceeds the 350ms grace: the credit is gone.
    expect(steps.at(-1)!.state.detectedMs).toBe(50);
  });
});

describe("advanceShutter — firing cadence", () => {
  it("spends the credit on firing, so it does not burst", () => {
    const fires = run(times(36, good)).filter((s) => s.fire).length;
    // 36 frames x 50ms = 1800ms; at 600ms a shot with a reset after each,
    // that is exactly 3 — not 25.
    expect(fires).toBe(3);
  });

  it("a zero or negative requirement never means fire-immediately", () => {
    for (const requiredDetectedMs of [0, -100]) {
      const step = advanceShutter(INITIAL_SHUTTER, {
        detected: true,
        guidanceFor: () => "ready",
        elapsedMs: 50,
        graceMs: GRACE_MS,
        requiredDetectedMs,
      });
      expect(step.fire).toBe(false);
    }
  });
});

describe("advanceShutter — outline persistence", () => {
  it("holds the outline through the grace window then clears it", () => {
    const steps = run([good, ...times(12, miss)]);
    expect(steps[1]!.outline).toBe("hold");
    expect(steps.at(-1)!.outline).toBe("clear");
    // The clear lands on the first tick past the window, in real time.
    const idx = steps.findIndex((s) => s.outline === "clear");
    expect(idx * 50).toBeGreaterThan(GRACE_MS);
    expect(idx * 50).toBeLessThanOrEqual(GRACE_MS + 50 * 2);
  });

  it("resets the miss clock as soon as the document reappears", () => {
    const steps = run([good, miss, miss, good, miss]);
    expect(steps[3]!.state.missMs).toBe(0);
    expect(steps[4]!.outline).toBe("hold");
  });

  it("clears immediately when there was never anything to hold", () => {
    const steps = run(times(12, miss));
    expect(steps.at(-1)!.outline).toBe("clear");
    expect(steps.at(-1)!.documentPresent).toBe(false);
  });
});

describe("advanceShutter — progress", () => {
  it("climbs from 0 to 1 as detection time accrues", () => {
    const steps = run(times(12, good));
    expect(steps[0]!.progress).toBeCloseTo(50 / 600, 5);
    expect(steps[5]!.progress).toBeCloseTo(300 / 600, 5);
    expect(steps[11]!.progress).toBe(1);
  });
});

describe("advanceShutter — hostile timing", () => {
  it("treats a huge gap as one ordinary step", () => {
    // A backgrounded tab or a paused debugger can hand us seconds; crediting
    // all of it would fire on a frame nobody was looking at.
    const step = advanceShutter(
      { detectedMs: 400, missMs: 0 },
      {
        detected: true,
        guidanceFor: () => "ready",
        elapsedMs: 30_000,
        graceMs: GRACE_MS,
        requiredDetectedMs: REQUIRED_MS,
      },
    );
    expect(step.state.detectedMs).toBeLessThanOrEqual(400 + 250);
  });

  it("ignores a non-finite or negative interval rather than corrupting state", () => {
    for (const elapsedMs of [NaN, Infinity, -100, 0]) {
      const step = advanceShutter(
        { detectedMs: 200, missMs: 0 },
        {
          detected: true,
          guidanceFor: () => "ready",
          elapsedMs,
          graceMs: GRACE_MS,
          requiredDetectedMs: REQUIRED_MS,
        },
      );
      expect(Number.isFinite(step.state.detectedMs)).toBe(true);
      expect(step.state.detectedMs).toBe(200);
    }
  });

  it("does not mutate the state it is given", () => {
    const prev: ShutterState = { detectedMs: 120, missMs: 40 };
    const snapshot = { ...prev };
    advanceShutter(prev, {
      detected: true,
      guidanceFor: () => "ready",
      elapsedMs: 50,
      graceMs: GRACE_MS,
      requiredDetectedMs: REQUIRED_MS,
    });
    expect(prev).toEqual(snapshot);
  });
});
