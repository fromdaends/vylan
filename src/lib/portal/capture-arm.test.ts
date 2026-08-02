import { describe, it, expect } from "vitest";
import { ARMED, advanceArm, disarm, maxCornerDelta } from "./capture-arm";
import type { Quad } from "./rectify";

const quadAt = (dx: number, dy: number): Quad =>
  [
    { x: 10 + dx, y: 10 + dy },
    { x: 90 + dx, y: 12 + dy },
    { x: 88 + dx, y: 120 + dy },
    { x: 12 + dx, y: 118 + dy },
  ] as unknown as Quad;

const OPTS = {
  minDelayMs: 1500,
  moveTolerancePx: 12,
  clearMissMs: 500,
};

function run(
  state = disarm(quadAt(0, 0)),
  frames: { quad: Quad | null; elapsedMs?: number }[],
) {
  let s = state;
  for (const f of frames) {
    s = advanceArm(s, { ...OPTS, elapsedMs: f.elapsedMs ?? 100, quad: f.quad });
  }
  return s;
}

describe("advanceArm", () => {
  it("leaves an armed state alone", () => {
    const s = advanceArm(ARMED, { ...OPTS, elapsedMs: 100, quad: null });
    expect(s).toBe(ARMED);
  });

  it("stays disarmed while the same document sits still, however long", () => {
    // 5 seconds of the very sheet that was just banked, dead centre.
    const s = run(
      undefined,
      Array.from({ length: 50 }, () => ({ quad: quadAt(0, 0) })),
    );
    expect(s.armed).toBe(false);
  });

  it("holds through the debounce even once the document has clearly moved", () => {
    // 1.0s < minDelayMs, so movement alone must not re-arm early.
    const s = run(
      undefined,
      Array.from({ length: 10 }, () => ({ quad: quadAt(60, 60) })),
    );
    expect(s.armed).toBe(false);
  });

  it("re-arms once the debounce has passed and the document has moved", () => {
    const s = run(
      undefined,
      Array.from({ length: 20 }, () => ({ quad: quadAt(60, 60) })),
    );
    expect(s.armed).toBe(true);
  });

  it("ignores jitter under the tolerance", () => {
    const s = run(
      undefined,
      Array.from({ length: 30 }, () => ({ quad: quadAt(3, -2) })),
    );
    expect(s.armed).toBe(false);
  });

  it("re-arms when the document leaves the frame long enough", () => {
    const s = run(undefined, [
      ...Array.from({ length: 16 }, () => ({ quad: quadAt(0, 0) })),
      ...Array.from({ length: 6 }, () => ({ quad: null })),
    ]);
    expect(s.armed).toBe(true);
  });

  it("does not re-arm on a brief detection dropout", () => {
    const s = run(undefined, [
      ...Array.from({ length: 16 }, () => ({ quad: quadAt(0, 0) })),
      { quad: null },
      { quad: null },
      { quad: quadAt(1, 1) },
    ]);
    expect(s.armed).toBe(false);
  });

  it("re-arms on time alone when the banked shot had no quad", () => {
    // The uncropped safety-net capture leaves no reference to compare
    // against; without this the client would be locked out of auto-capture
    // for the rest of the session.
    const s = run(
      disarm(null),
      Array.from({ length: 20 }, () => ({ quad: quadAt(0, 0) })),
    );
    expect(s.armed).toBe(true);
  });

  it("treats a suspended-tab time gap as one ordinary step", () => {
    const s = advanceArm(disarm(quadAt(0, 0)), {
      ...OPTS,
      elapsedMs: 60_000,
      quad: quadAt(0, 0),
    });
    expect(s.armed).toBe(false);
    expect(s.sinceMs).toBeLessThanOrEqual(250);
  });

  it("survives a non-finite elapsed without accumulating", () => {
    const s = advanceArm(disarm(quadAt(0, 0)), {
      ...OPTS,
      elapsedMs: Number.NaN,
      quad: quadAt(0, 0),
    });
    expect(s.sinceMs).toBe(0);
  });
});

describe("maxCornerDelta", () => {
  it("is zero for identical quads", () => {
    expect(maxCornerDelta(quadAt(0, 0), quadAt(0, 0))).toBe(0);
  });

  it("reports the largest single-corner move, not the average", () => {
    const a = quadAt(0, 0);
    const b = [a[0], a[1], a[2], { x: a[3].x + 30, y: a[3].y }] as unknown as Quad;
    expect(maxCornerDelta(a, b)).toBeCloseTo(30, 5);
  });
});
