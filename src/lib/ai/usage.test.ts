import { describe, it, expect } from "vitest";
import {
  aiCapStatus,
  aiTrialCapStatus,
  isTrialCapped,
  DEFAULT_AI_MONTHLY_CAP,
  TRIAL_AI_TOTAL_CAP,
} from "./usage";

const now = new Date(Date.UTC(2026, 5, 7, 12, 0, 0)); // 2026-06-07 UTC

describe("aiCapStatus", () => {
  it("is not paused below the cap", () => {
    const s = aiCapStatus(399, 400, now);
    expect(s.paused).toBe(false);
    expect(s.used).toBe(399);
    expect(s.cap).toBe(400);
    expect(s.isTrial).toBe(false);
  });

  it("pauses at and above the cap", () => {
    expect(aiCapStatus(400, 400, now).paused).toBe(true);
    expect(aiCapStatus(450, 400, now).paused).toBe(true);
  });

  it("resets on the first day of the next UTC month (incl. year rollover)", () => {
    expect(aiCapStatus(0, 400, now).resetsAt).toBe("2026-07-01T00:00:00.000Z");
    const dec = new Date(Date.UTC(2026, 11, 20));
    expect(aiCapStatus(0, 400, dec).resetsAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("falls back to the default cap for invalid values", () => {
    expect(aiCapStatus(0, Number.NaN, now).cap).toBe(DEFAULT_AI_MONTHLY_CAP);
    expect(aiCapStatus(0, -5, now).cap).toBe(DEFAULT_AI_MONTHLY_CAP);
  });
});

describe("isTrialCapped", () => {
  it("caps an unconverted trial firm (is_demo, no paid subscription)", () => {
    expect(isTrialCapped({ is_demo: true, subscription_status: null })).toBe(
      true,
    );
    expect(
      isTrialCapped({ is_demo: true, subscription_status: "canceled" }),
    ).toBe(true);
  });

  it("does NOT cap a converted/paying firm", () => {
    expect(isTrialCapped({ is_demo: false, subscription_status: null })).toBe(
      false,
    );
  });

  it("exempts a trial firm that has started paying (webhook lag safety)", () => {
    expect(
      isTrialCapped({ is_demo: true, subscription_status: "active" }),
    ).toBe(false);
    expect(
      isTrialCapped({ is_demo: true, subscription_status: "trialing" }),
    ).toBe(false);
  });
});

describe("aiTrialCapStatus", () => {
  it("pauses at the trial cap on the LIFETIME total", () => {
    expect(aiTrialCapStatus(9, TRIAL_AI_TOTAL_CAP, null).paused).toBe(false);
    expect(aiTrialCapStatus(10, TRIAL_AI_TOTAL_CAP, null).paused).toBe(true);
    expect(aiTrialCapStatus(50, TRIAL_AI_TOTAL_CAP, null).paused).toBe(true);
  });

  it("flags itself as a trial cap (drives the upgrade banner)", () => {
    const s = aiTrialCapStatus(10, TRIAL_AI_TOTAL_CAP, "2026-06-20T00:00:00Z");
    expect(s.isTrial).toBe(true);
    expect(s.cap).toBe(TRIAL_AI_TOTAL_CAP);
    expect(s.resetsAt).toBe("2026-06-20T00:00:00Z");
  });

  it("uses a low default cap (≤ the monthly default)", () => {
    expect(TRIAL_AI_TOTAL_CAP).toBeLessThan(DEFAULT_AI_MONTHLY_CAP);
    expect(aiTrialCapStatus(0, Number.NaN, null).cap).toBe(TRIAL_AI_TOTAL_CAP);
  });
});
