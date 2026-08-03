import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldReconcile,
  RECONCILE_TTL_MS,
  __resetReconcileThrottleForTests,
} from "./reconcile-throttle";

beforeEach(() => {
  __resetReconcileThrottleForTests();
});

describe("shouldReconcile", () => {
  it("allows the first call for a key", () => {
    expect(shouldReconcile("stripe:pr-1", RECONCILE_TTL_MS, 1_000)).toBe(true);
  });

  it("blocks repeats inside the TTL — the AutoRefresh case", () => {
    // A 5s AutoRefresh cadence: 12 renders in a minute must cost ONE call.
    let calls = 0;
    for (let tick = 0; tick < 12; tick++) {
      if (shouldReconcile("stripe:pr-1", RECONCILE_TTL_MS, tick * 5_000)) {
        calls += 1;
      }
    }
    expect(calls).toBe(1);
  });

  it("allows again once the TTL has passed — a fresh visit still heals", () => {
    expect(shouldReconcile("stripe:pr-1", RECONCILE_TTL_MS, 0)).toBe(true);
    expect(
      shouldReconcile("stripe:pr-1", RECONCILE_TTL_MS, RECONCILE_TTL_MS),
    ).toBe(true);
  });

  it("keys are independent — one throttled payment doesn't gag another", () => {
    expect(shouldReconcile("stripe:pr-1", RECONCILE_TTL_MS, 0)).toBe(true);
    expect(shouldReconcile("stripe:pr-2", RECONCILE_TTL_MS, 0)).toBe(true);
    expect(shouldReconcile("signwell:sr-1", RECONCILE_TTL_MS, 0)).toBe(true);
  });

  it("a blocked call does NOT extend the window", () => {
    // Blocked attempts must not keep pushing the next allowed call out.
    expect(shouldReconcile("k", RECONCILE_TTL_MS, 0)).toBe(true);
    expect(shouldReconcile("k", RECONCILE_TTL_MS, 59_000)).toBe(false);
    expect(shouldReconcile("k", RECONCILE_TTL_MS, 60_000)).toBe(true);
  });
});
