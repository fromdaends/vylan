import { describe, it, expect } from "vitest";
import {
  claimAction,
  nextFailedState,
  MAX_ATTEMPTS,
  LEASE_MS,
} from "./jobs";

describe("claimAction — attempt counting + give-up cap", () => {
  it("claims a fresh job as attempt 1", () => {
    expect(claimAction(0)).toEqual({ action: "claim", nextAttempts: 1 });
  });

  it("keeps incrementing while under the cap", () => {
    expect(claimAction(1)).toEqual({ action: "claim", nextAttempts: 2 });
    expect(claimAction(MAX_ATTEMPTS - 1)).toEqual({
      action: "claim",
      nextAttempts: MAX_ATTEMPTS,
    });
  });

  it("gives up once attempts reach the cap, so a job can never loop forever", () => {
    expect(claimAction(MAX_ATTEMPTS).action).toBe("give_up");
    expect(claimAction(MAX_ATTEMPTS + 3).action).toBe("give_up");
  });
});

describe("nextFailedState — retry vs terminal", () => {
  it("retries with a short, minutes-scale backoff while under the cap", () => {
    const a1 = nextFailedState(1);
    expect(a1.status).toBe("pending");
    expect(a1.delayMs).toBe(60_000); // 1 minute
    expect(nextFailedState(3).delayMs).toBe(3 * 60_000);
  });

  it("never schedules the hour-long backoff the old code used", () => {
    for (let a = 1; a < MAX_ATTEMPTS; a++) {
      expect(nextFailedState(a).status).toBe("pending");
      expect(nextFailedState(a).delayMs).toBeLessThanOrEqual(5 * 60_000);
    }
  });

  it("goes terminal (failed) once attempts are exhausted", () => {
    expect(nextFailedState(MAX_ATTEMPTS)).toEqual({
      status: "failed",
      delayMs: 0,
    });
    expect(nextFailedState(MAX_ATTEMPTS + 2).status).toBe("failed");
  });
});

describe("queue safety invariants", () => {
  it("leases a claimed job past the worker's own 60s cap, so a still-running job is never yanked", () => {
    expect(LEASE_MS).toBeGreaterThan(60_000);
  });

  it("allows several retries before abandoning a job", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(3);
  });
});
