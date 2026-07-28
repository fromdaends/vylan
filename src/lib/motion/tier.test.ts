import { describe, it, expect } from "vitest";
import {
  downgrade,
  initialTier,
  isJanky,
  parseMotionParam,
  summarizeFrames,
  tierAfterSample,
  type MotionSignals,
} from "./tier";

const CAPABLE: MotionSignals = {
  saveData: false,
  deviceMemoryGb: 8,
  cores: 8,
};

// Steady 60fps / 30fps / stuttering streams. The first delta is always dropped
// by summarizeFrames (it measures scheduling, not painting), so every fixture
// carries one extra leading value.
const at = (ms: number, n = 20) => [999, ...Array(n).fill(ms)];

describe("initialTier", () => {
  it("gives a capable machine the full effect", () => {
    expect(initialTier(CAPABLE)).toBe("full");
  });

  it("steps down for a low-memory or low-core device", () => {
    expect(initialTier({ ...CAPABLE, deviceMemoryGb: 2 })).toBe("soft");
    expect(initialTier({ ...CAPABLE, cores: 2 })).toBe("soft");
  });

  it("respects an explicit data-saver preference", () => {
    expect(initialTier({ ...CAPABLE, saveData: true })).toBe("soft");
  });

  it("drops the blur entirely on a 1GB device", () => {
    expect(initialTier({ ...CAPABLE, deviceMemoryGb: 1 })).toBe("plain");
  });

  it("does not downgrade when the browser reports nothing about itself", () => {
    // Safari and Firefox expose neither hint — absent must not read as weak.
    expect(
      initialTier({ saveData: false, deviceMemoryGb: null, cores: null }),
    ).toBe("full");
  });
});

describe("summarizeFrames", () => {
  it("drops the first delta and averages the rest", () => {
    const s = summarizeFrames([500, 16, 16, 16, 16, 16, 16])!;
    expect(s.frames).toBe(6);
    expect(s.meanMs).toBeCloseTo(16, 5);
    expect(s.worstMs).toBe(16);
  });

  it("returns null when there are too few frames to judge", () => {
    expect(summarizeFrames([16, 16, 16])).toBeNull();
    expect(summarizeFrames([])).toBeNull();
  });

  it("ignores non-finite or non-positive deltas", () => {
    // Leading 9 is dropped as the scheduling delta; the 0 and the NaN are
    // filtered out, leaving seven 16ms frames.
    const s = summarizeFrames([9, 16, 0, 16, NaN, 16, 16, 16, 16, 16])!;
    expect(s.frames).toBe(7);
    expect(s.meanMs).toBeCloseTo(16, 5);
  });
});

describe("isJanky", () => {
  it("passes a healthy 60fps stream", () => {
    expect(isJanky(summarizeFrames(at(16))!)).toBe(false);
  });

  it("passes a steady 30fps stream — smooth enough for a 0.5s fade", () => {
    expect(isJanky(summarizeFrames(at(30))!)).toBe(false);
  });

  it("fails a sustained slow stream", () => {
    expect(isJanky(summarizeFrames(at(45))!)).toBe(true);
  });

  it("fails on a single visible hitch even when the average looks fine", () => {
    const deltas = [999, ...Array(19).fill(16), 240];
    expect(isJanky(summarizeFrames(deltas)!)).toBe(true);
  });
});

describe("tierAfterSample", () => {
  it("steps down one rung on jank", () => {
    expect(tierAfterSample("full", summarizeFrames(at(45))!)).toBe("soft");
    expect(tierAfterSample("soft", summarizeFrames(at(45))!)).toBe("plain");
  });

  it("bottoms out at plain", () => {
    expect(tierAfterSample("plain", summarizeFrames(at(45))!)).toBe("plain");
    expect(downgrade("plain")).toBe("plain");
  });

  it("holds the tier on a healthy sample — and never upgrades back", () => {
    expect(tierAfterSample("full", summarizeFrames(at(16))!)).toBe("full");
    // A device that stuttered once keeps the cheaper effect; flapping between
    // budgets mid-scroll looks worse than either budget.
    expect(tierAfterSample("soft", summarizeFrames(at(16))!)).toBe("soft");
    expect(tierAfterSample("plain", summarizeFrames(at(16))!)).toBe("plain");
  });

  it("keeps the current tier when the sample was discarded", () => {
    // Null is what a backgrounded tab produces — no evidence, no change.
    expect(tierAfterSample("full", null)).toBe("full");
  });
});

describe("parseMotionParam", () => {
  it("turns on the readout for ?motion=debug without forcing a tier", () => {
    expect(parseMotionParam("debug")).toEqual({ forced: null, debug: true });
  });

  it("forces a tier and shows the readout for an explicit tier", () => {
    expect(parseMotionParam("full")).toEqual({ forced: "full", debug: true });
    expect(parseMotionParam("PLAIN")).toEqual({ forced: "plain", debug: true });
  });

  it("ignores anything else, including a missing param", () => {
    expect(parseMotionParam(null)).toEqual({ forced: null, debug: false });
    expect(parseMotionParam("")).toEqual({ forced: null, debug: false });
    expect(parseMotionParam("yes")).toEqual({ forced: null, debug: false });
  });
});
