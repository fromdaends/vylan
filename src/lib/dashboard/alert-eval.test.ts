import { describe, it, expect } from "vitest";
import { decideAlert, isBreached, type AlertRule } from "./alert-eval";

const NOW = new Date("2026-08-05T09:00:00Z");

const rule = (r: Partial<AlertRule> = {}): AlertRule => ({
  id: "a1",
  comparator: "gt",
  threshold: 100,
  frequency: "daily",
  lastValue: null,
  lastFiredAt: null,
  ...r,
});

describe("isBreached", () => {
  it("is strict on both sides — exactly the threshold is not over it", () => {
    expect(isBreached(101, { comparator: "gt", threshold: 100 })).toBe(true);
    expect(isBreached(100, { comparator: "gt", threshold: 100 })).toBe(false);
    expect(isBreached(99, { comparator: "lt", threshold: 100 })).toBe(true);
    expect(isBreached(100, { comparator: "lt", threshold: 100 })).toBe(false);
  });
});

describe("decideAlert — it fires on the CROSSING, not on the state", () => {
  it("fires the first time the line is crossed", () => {
    expect(decideAlert(140, rule({ lastValue: 80 }), NOW)).toEqual({
      fire: true,
      reason: "crossed",
    });
  });

  it("stays SILENT while the threshold remains crossed", () => {
    // The whole point. "Open tasks > 100" checked daily on a firm sitting at
    // 140 for a month is thirty identical notifications; the thirtieth is
    // worth nothing and the first is worth less because of them.
    expect(decideAlert(140, rule({ lastValue: 130 }), NOW)).toEqual({
      fire: false,
      reason: "still_breached",
    });
  });

  it("fires AGAIN after the number comes back under and goes over", () => {
    // Coming back under and crossing again is genuinely new information.
    const cooled = rule({
      lastValue: 90,
      lastFiredAt: "2026-07-01T09:00:00Z",
    });
    expect(decideAlert(140, cooled, NOW).fire).toBe(true);
  });

  it("says nothing at all when the condition is not met", () => {
    expect(decideAlert(40, rule({ lastValue: 140 }), NOW)).toEqual({
      fire: false,
      reason: "not_breached",
    });
  });

  it("fires on a brand-new alert that is already over the line", () => {
    // You asked to be told when it was over 100 and it is over 100. Staying
    // quiet for want of history would mean the alert you just made does
    // nothing until the number happens to dip.
    expect(decideAlert(140, rule({ lastValue: null }), NOW).fire).toBe(true);
  });

  it("holds an oscillating value to one notification per period", () => {
    // 101 → 99 → 101 within a day is two crossings but one useful message.
    const flapping = rule({
      lastValue: 99,
      lastFiredAt: "2026-08-05T06:00:00Z", // three hours ago
    });
    expect(decideAlert(101, flapping, NOW)).toEqual({
      fire: false,
      reason: "cooling_down",
    });
  });

  it("uses each frequency's own cooldown", () => {
    const sixHoursAgo = "2026-08-05T03:00:00Z";
    // Hourly has long since cooled; daily has not.
    expect(
      decideAlert(101, rule({ lastValue: 99, frequency: "hourly", lastFiredAt: sixHoursAgo }), NOW)
        .fire,
    ).toBe(true);
    expect(
      decideAlert(101, rule({ lastValue: 99, frequency: "daily", lastFiredAt: sixHoursAgo }), NOW)
        .fire,
    ).toBe(false);
  });

  it("does not go permanently silent on a malformed timestamp", () => {
    // NaN compares false against everything, which would silently turn the
    // cooldown into "never again" if it were written the other way round.
    expect(
      decideAlert(101, rule({ lastValue: 99, lastFiredAt: "not-a-date" }), NOW).fire,
    ).toBe(true);
  });

  it("works the same way downward", () => {
    const under = rule({ comparator: "lt", threshold: 10, lastValue: 25 });
    expect(decideAlert(4, under, NOW).fire).toBe(true);
    expect(decideAlert(4, { ...under, lastValue: 5 }, NOW).reason).toBe(
      "still_breached",
    );
  });
});
