import { describe, it, expect } from "vitest";
import {
  advanceShutter,
  INITIAL_SHUTTER,
  type ShutterState,
} from "./auto-shutter";
import type { Guidance } from "./frame-metrics";

const GRACE = 3;
const REQUIRED = 6;

/** Run a sequence of frames and collect every step. */
function run(frames: { detected: boolean; guidance: Guidance }[]) {
  let state: ShutterState = INITIAL_SHUTTER;
  return frames.map((f) => {
    const step = advanceShutter(state, {
      detected: f.detected,
      guidanceFor: () => f.guidance,
      graceFrames: GRACE,
      requiredFrames: REQUIRED,
    });
    state = step.state;
    return step;
  });
}

const good = { detected: true, guidance: "ready" as Guidance };
const seenButFar = { detected: true, guidance: "too_far" as Guidance };
const miss = { detected: false, guidance: "searching" as Guidance };

describe("advanceShutter — firing", () => {
  it("fires on exactly the sixth consecutive good frame, not before", () => {
    const steps = run(Array(6).fill(good));
    expect(steps.slice(0, 5).map((s) => s.fire)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(steps[5]!.fire).toBe(true);
  });

  it("does not fire again on the very next frame", () => {
    // Otherwise a steady hand produces a burst of near-identical photos, each
    // one its own upload and its own AI check against the firm's budget.
    const steps = run(Array(9).fill(good));
    expect(steps.map((s) => s.fire)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it("never fires while the document is found but not yet framed well", () => {
    const steps = run(Array(20).fill(seenButFar));
    expect(steps.some((s) => s.fire)).toBe(false);
  });

  it("restarts the count when guidance lapses mid-run", () => {
    const steps = run([
      good,
      good,
      good,
      good,
      good,
      { detected: true, guidance: "hold_steady" },
      good,
      good,
      good,
      good,
      good,
    ]);
    expect(steps.some((s) => s.fire)).toBe(false);
    expect(steps.at(-1)!.state.readyStreak).toBe(5);
  });

  it("restarts the count on a dropped frame even though the outline is held", () => {
    // The whole point of separating the two: the outline may coast over a
    // dropped frame, the shutter may not.
    const steps = run([good, good, good, good, good, miss, good]);
    expect(steps[5]!.outline).toBe("hold");
    expect(steps[5]!.state.readyStreak).toBe(0);
    expect(steps[6]!.fire).toBe(false);
    expect(steps[6]!.state.readyStreak).toBe(1);
  });

  it("fires again after a genuine retake-style gap", () => {
    const steps = run([...Array(6).fill(good), ...Array(6).fill(good)]);
    expect(steps.filter((s) => s.fire).length).toBe(2);
  });
});

describe("advanceShutter — outline persistence", () => {
  it("holds the outline through short gaps then clears it", () => {
    const steps = run([good, miss, miss, miss, miss]);
    expect(steps.map((s) => s.outline)).toEqual([
      "update",
      "hold",
      "hold",
      "hold",
      "clear",
    ]);
  });

  it("keeps reporting a document through the grace window, then stops", () => {
    const steps = run([good, miss, miss, miss, miss]);
    expect(steps.map((s) => s.documentPresent)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("resets the miss run as soon as the document reappears", () => {
    const steps = run([good, miss, miss, good, miss]);
    expect(steps[3]!.state.missStreak).toBe(0);
    expect(steps[4]!.outline).toBe("hold");
  });

  it("clears immediately when there was never anything to hold", () => {
    // A client who opens the scanner pointing at nothing should be told to
    // point at their document, not shown a phantom outline.
    const steps = run([miss, miss, miss, miss]);
    expect(steps.at(-1)!.outline).toBe("clear");
    expect(steps.at(-1)!.documentPresent).toBe(false);
  });

  it("treats a zero grace window as clear-on-first-miss", () => {
    const step = advanceShutter(INITIAL_SHUTTER, {
      detected: false,
      guidanceFor: () => "searching",
      graceFrames: 0,
      requiredFrames: REQUIRED,
    });
    expect(step.outline).toBe("clear");
    expect(step.documentPresent).toBe(false);
  });
});

describe("advanceShutter — purity", () => {
  it("does not mutate the state it is given", () => {
    const prev: ShutterState = { readyStreak: 4, missStreak: 2 };
    const snapshot = { ...prev };
    advanceShutter(prev, {
      detected: true,
      guidanceFor: () => "ready",
      graceFrames: GRACE,
      requiredFrames: REQUIRED,
    });
    expect(prev).toEqual(snapshot);
  });

  it("is deterministic for the same input", () => {
    const args = {
      detected: true,
      guidanceFor: () => "ready" as Guidance,
      graceFrames: GRACE,
      requiredFrames: REQUIRED,
    };
    const a = advanceShutter({ readyStreak: 5, missStreak: 0 }, args);
    const b = advanceShutter({ readyStreak: 5, missStreak: 0 }, args);
    expect(a).toEqual(b);
    expect(a.fire).toBe(true);
  });
});
