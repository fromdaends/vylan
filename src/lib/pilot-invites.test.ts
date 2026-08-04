import { describe, it, expect } from "vitest";
import { pilotFirmFields } from "./pilot-invites";
import { trialEndsAtFrom, TRIAL_DAYS } from "./trial";
import { isTrialCapped } from "./ai/usage";

const NOW = Date.parse("2026-08-05T12:00:00Z");
const DAY = 86_400_000;

describe("pilotFirmFields", () => {
  it("flags the firm as a pilot and copies the invite's monthly cap", () => {
    const f = pilotFirmFields({ ai_monthly_cap: 50, pilot_days: 90 }, NOW);
    expect(f.is_pilot).toBe(true);
    expect(f.ai_monthly_cap).toBe(50);
  });

  it("dates the clock from the SIGNUP instant, not the invite", () => {
    // A pilot invited weeks ago still gets their full window from the day they
    // actually sign up.
    const f = pilotFirmFields({ ai_monthly_cap: 50, pilot_days: 90 }, NOW);
    expect(Date.parse(f.trial_ends_at) - NOW).toBe(90 * DAY);
  });

  it("honours a non-default pilot length", () => {
    const f = pilotFirmFields({ ai_monthly_cap: 25, pilot_days: 30 }, NOW);
    expect(Date.parse(f.trial_ends_at) - NOW).toBe(30 * DAY);
    expect(f.ai_monthly_cap).toBe(25);
  });

  it("runs materially longer than the ordinary free trial", () => {
    // The whole point: a pilot must not be silently handed a 14-day window.
    const pilot = pilotFirmFields({ ai_monthly_cap: 50, pilot_days: 90 }, NOW);
    expect(Date.parse(pilot.trial_ends_at)).toBeGreaterThan(
      Date.parse(trialEndsAtFrom(NOW)),
    );
    expect(TRIAL_DAYS).toBeLessThan(90);
  });

  // The end-to-end guarantee this whole feature exists for: the fields written
  // at signup must put the firm on the MONTHLY meter. If isTrialCapped ever
  // returns true for a freshly created pilot, the account is silently capped at
  // ten AI checks for life and the pilot is worthless.
  it("produces a firm that meters monthly, not on the lifetime ceiling", () => {
    const f = pilotFirmFields({ ai_monthly_cap: 50, pilot_days: 90 }, NOW);
    const firmRow = {
      is_demo: true, // a pilot is still an unconverted account
      subscription_status: null, // and has no Stripe subscription
      is_pilot: f.is_pilot,
    };
    expect(isTrialCapped(firmRow)).toBe(false);
  });

  it("a firm created WITHOUT an invite still hits the lifetime ceiling", () => {
    // Guards the other direction: the pilot path must not leak to normal
    // signups.
    expect(
      isTrialCapped({ is_demo: true, subscription_status: null }),
    ).toBe(true);
  });
});
