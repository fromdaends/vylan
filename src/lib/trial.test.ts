import { describe, it, expect } from "vitest";
import {
  TRIAL_DAYS,
  trialEndsAtFrom,
  isOnTrial,
  isTrialExpired,
  trialDaysLeft,
} from "./trial";

const NOW = Date.parse("2026-06-08T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("trialEndsAtFrom", () => {
  it("is exactly TRIAL_DAYS after the start", () => {
    const end = trialEndsAtFrom(NOW);
    expect(Date.parse(end) - NOW).toBe(TRIAL_DAYS * DAY);
  });
});

describe("isOnTrial", () => {
  it("tracks the is_demo flag", () => {
    expect(isOnTrial({ is_demo: true })).toBe(true);
    expect(isOnTrial({ is_demo: false })).toBe(false);
  });
});

describe("isTrialExpired", () => {
  const base = {
    is_demo: true,
    trial_ends_at: iso(NOW - DAY), // lapsed yesterday
    subscription_status: null,
  };

  it("is expired for a trial firm past its clock with no subscription", () => {
    expect(isTrialExpired(base, NOW)).toBe(true);
  });

  it("is not expired for a paid/live firm (is_demo false)", () => {
    expect(isTrialExpired({ ...base, is_demo: false }, NOW)).toBe(false);
  });

  it("is not expired while the clock is still in the future", () => {
    expect(
      isTrialExpired({ ...base, trial_ends_at: iso(NOW + DAY) }, NOW),
    ).toBe(false);
  });

  it("is not expired when there is no clock set yet", () => {
    expect(isTrialExpired({ ...base, trial_ends_at: null }, NOW)).toBe(false);
  });

  it("is not expired when a Stripe subscription is active or trialing", () => {
    expect(
      isTrialExpired({ ...base, subscription_status: "active" }, NOW),
    ).toBe(false);
    expect(
      isTrialExpired({ ...base, subscription_status: "trialing" }, NOW),
    ).toBe(false);
  });

  it("stays expired for other subscription statuses (e.g. canceled, past_due)", () => {
    expect(
      isTrialExpired({ ...base, subscription_status: "canceled" }, NOW),
    ).toBe(true);
  });
});

describe("trialDaysLeft", () => {
  it("rounds up partial days remaining", () => {
    // 3.5 days left → 4
    expect(trialDaysLeft({ trial_ends_at: iso(NOW + 3.5 * DAY) }, NOW)).toBe(4);
  });

  it("returns the full window on day zero", () => {
    expect(trialDaysLeft({ trial_ends_at: trialEndsAtFrom(NOW) }, NOW)).toBe(
      TRIAL_DAYS,
    );
  });

  it("returns 0 once the clock has passed", () => {
    expect(trialDaysLeft({ trial_ends_at: iso(NOW - DAY) }, NOW)).toBe(0);
  });

  it("returns null when no clock is set", () => {
    expect(trialDaysLeft({ trial_ends_at: null }, NOW)).toBe(null);
  });
});
