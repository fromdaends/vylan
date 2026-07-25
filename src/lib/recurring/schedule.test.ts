import { describe, expect, it } from "vitest";
import {
  compareLocalDates,
  cycleMonths,
  daysInMonth,
  dueDateFor,
  isRecurringFrequency,
  localToday,
  nextSpawn,
  parseIsoDate,
  periodKeyFor,
  resolveDueSpawn,
  toIsoDate,
} from "./schedule";

describe("localToday", () => {
  it("returns the firm-local calendar date, not the UTC one", () => {
    // 2027-03-01 02:30 UTC is still 2027-02-28 21:30 in Toronto (UTC-5).
    const now = new Date("2027-03-01T02:30:00Z");
    expect(localToday("America/Toronto", now)).toEqual({
      year: 2027,
      month: 2,
      day: 28,
    });
    expect(localToday("UTC", now)).toEqual({ year: 2027, month: 3, day: 1 });
  });

  it("falls back to UTC parts on an unknown timezone", () => {
    const now = new Date("2027-07-15T12:00:00Z");
    expect(localToday("Not/AZone", now)).toEqual({
      year: 2027,
      month: 7,
      day: 15,
    });
  });
});

describe("daysInMonth", () => {
  it("knows short months and leap years", () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29); // leap
    expect(daysInMonth(2027, 4)).toBe(30);
    expect(daysInMonth(2027, 12)).toBe(31);
  });
});

describe("nextSpawn", () => {
  it("advances monthly on the anchor day", () => {
    expect(
      nextSpawn({ year: 2027, month: 3, day: 12 }, "monthly", 12),
    ).toEqual({ year: 2027, month: 4, day: 12 });
  });

  it("clamps a day-31 anchor to short months, then restores it", () => {
    const jan = { year: 2027, month: 1, day: 31 };
    const feb = nextSpawn(jan, "monthly", 31);
    expect(feb).toEqual({ year: 2027, month: 2, day: 28 });
    // The anchor (31) is re-applied from the series, so March is the 31st
    // again — clamping never sticks.
    expect(nextSpawn(feb, "monthly", 31)).toEqual({
      year: 2027,
      month: 3,
      day: 31,
    });
  });

  it("clamps to Feb 29 in leap years", () => {
    expect(
      nextSpawn({ year: 2028, month: 1, day: 31 }, "monthly", 31),
    ).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it("advances quarterly by three months across a year boundary", () => {
    expect(
      nextSpawn({ year: 2027, month: 11, day: 15 }, "quarterly", 15),
    ).toEqual({ year: 2028, month: 2, day: 15 });
  });

  it("advances yearly, clamping a Feb 29 anchor in non-leap years", () => {
    expect(
      nextSpawn({ year: 2028, month: 2, day: 29 }, "yearly", 29),
    ).toEqual({ year: 2029, month: 2, day: 28 });
  });
});

describe("periodKeyFor", () => {
  it("builds monthly, quarterly, and yearly keys", () => {
    const d = { year: 2027, month: 3, day: 12 };
    expect(periodKeyFor("monthly", d)).toBe("2027-03");
    expect(periodKeyFor("quarterly", d)).toBe("2027-Q1");
    expect(periodKeyFor("yearly", d)).toBe("2027");
  });

  it("maps months to the right quarter", () => {
    expect(periodKeyFor("quarterly", { year: 2027, month: 4, day: 1 })).toBe(
      "2027-Q2",
    );
    expect(periodKeyFor("quarterly", { year: 2027, month: 12, day: 31 })).toBe(
      "2027-Q4",
    );
  });
});

describe("toIsoDate / parseIsoDate", () => {
  it("round-trips with zero padding", () => {
    const d = { year: 2027, month: 3, day: 5 };
    expect(toIsoDate(d)).toBe("2027-03-05");
    expect(parseIsoDate("2027-03-05")).toEqual(d);
  });

  it("rejects garbage", () => {
    expect(parseIsoDate("not-a-date")).toBeNull();
  });
});

describe("dueDateFor", () => {
  it("adds the offset in calendar days", () => {
    expect(dueDateFor({ year: 2027, month: 3, day: 1 }, 15)).toBe(
      "2027-03-16",
    );
  });

  it("crosses month and year boundaries", () => {
    expect(dueDateFor({ year: 2027, month: 12, day: 20 }, 15)).toBe(
      "2028-01-04",
    );
  });
});

describe("resolveDueSpawn", () => {
  const monthly = { frequency: "monthly" as const, anchorDay: 12 };

  it("returns null when the series is not due yet", () => {
    expect(
      resolveDueSpawn({
        ...monthly,
        nextSpawnOn: { year: 2027, month: 4, day: 12 },
        today: { year: 2027, month: 4, day: 11 },
      }),
    ).toBeNull();
  });

  it("spawns the scheduled period on the day, advancing one cycle", () => {
    expect(
      resolveDueSpawn({
        ...monthly,
        nextSpawnOn: { year: 2027, month: 4, day: 12 },
        today: { year: 2027, month: 4, day: 12 },
      }),
    ).toEqual({
      spawnDate: { year: 2027, month: 4, day: 12 },
      periodKey: "2027-04",
      nextSpawnOn: { year: 2027, month: 5, day: 12 },
    });
  });

  it("after downtime, spawns ONLY the latest due period — missed cycles are skipped, never backfilled", () => {
    // Cron dead since April: it's now July 3rd. April/May are skipped; the
    // latest due period is June 12 (July 12 hasn't arrived yet).
    expect(
      resolveDueSpawn({
        ...monthly,
        nextSpawnOn: { year: 2027, month: 4, day: 12 },
        today: { year: 2027, month: 7, day: 3 },
      }),
    ).toEqual({
      spawnDate: { year: 2027, month: 6, day: 12 },
      periodKey: "2027-06",
      nextSpawnOn: { year: 2027, month: 7, day: 12 },
    });
  });

  it("always lands next_spawn_on strictly in the future (no same-day double spawn)", () => {
    const due = resolveDueSpawn({
      ...monthly,
      nextSpawnOn: { year: 2027, month: 4, day: 12 },
      today: { year: 2027, month: 5, day: 12 },
    });
    // Today IS a scheduled day (May 12): spawn May, next is June — future.
    expect(due).toEqual({
      spawnDate: { year: 2027, month: 5, day: 12 },
      periodKey: "2027-05",
      nextSpawnOn: { year: 2027, month: 6, day: 12 },
    });
  });

  it("keeps the anchor through short-month clamping during catch-up", () => {
    // Day-31 series, down since January; today is March 30. Feb 28 is the
    // latest due (Mar 31 hasn't arrived); next is Mar 31 — anchor restored.
    expect(
      resolveDueSpawn({
        frequency: "monthly",
        anchorDay: 31,
        nextSpawnOn: { year: 2027, month: 1, day: 31 },
        today: { year: 2027, month: 3, day: 30 },
      }),
    ).toEqual({
      spawnDate: { year: 2027, month: 2, day: 28 },
      periodKey: "2027-02",
      nextSpawnOn: { year: 2027, month: 3, day: 31 },
    });
  });

  it("works for quarterly and yearly frequencies", () => {
    expect(
      resolveDueSpawn({
        frequency: "quarterly",
        anchorDay: 1,
        nextSpawnOn: { year: 2027, month: 10, day: 1 },
        today: { year: 2027, month: 10, day: 1 },
      }),
    ).toEqual({
      spawnDate: { year: 2027, month: 10, day: 1 },
      periodKey: "2027-Q4",
      nextSpawnOn: { year: 2028, month: 1, day: 1 },
    });
    expect(
      resolveDueSpawn({
        frequency: "yearly",
        anchorDay: 15,
        nextSpawnOn: { year: 2027, month: 3, day: 15 },
        today: { year: 2029, month: 1, day: 1 },
      }),
    ).toEqual({
      // 2027's spawn was missed; 2028's (Mar 15 2028) is the latest due one,
      // so only it spawns. 2029's hasn't arrived yet.
      spawnDate: { year: 2028, month: 3, day: 15 },
      periodKey: "2028",
      nextSpawnOn: { year: 2029, month: 3, day: 15 },
    });
  });
});

describe("compareLocalDates", () => {
  it("orders dates correctly", () => {
    const a = { year: 2027, month: 3, day: 12 };
    expect(compareLocalDates(a, { year: 2027, month: 3, day: 12 })).toBe(0);
    expect(compareLocalDates(a, { year: 2027, month: 3, day: 13 })).toBe(-1);
    expect(compareLocalDates(a, { year: 2026, month: 12, day: 31 })).toBe(1);
    expect(compareLocalDates(a, { year: 2027, month: 4, day: 1 })).toBe(-1);
  });
});

describe("isRecurringFrequency", () => {
  it("accepts the four frequencies and nothing else", () => {
    expect(isRecurringFrequency("monthly")).toBe(true);
    expect(isRecurringFrequency("quarterly")).toBe(true);
    expect(isRecurringFrequency("yearly")).toBe(true);
    expect(isRecurringFrequency("custom")).toBe(true);
    expect(isRecurringFrequency("off")).toBe(false);
    expect(isRecurringFrequency("weekly")).toBe(false);
  });
});

// Custom recurrence (migration 0890): "every N months, on day D".
describe("cycleMonths", () => {
  it("uses the fixed cycle for the three built-in frequencies", () => {
    expect(cycleMonths("monthly", null)).toBe(1);
    expect(cycleMonths("quarterly", null)).toBe(3);
    expect(cycleMonths("yearly", null)).toBe(12);
  });

  it("uses the series' interval for a custom schedule", () => {
    expect(cycleMonths("custom", 2)).toBe(2);
    expect(cycleMonths("custom", 6)).toBe(6);
  });

  it("ignores the interval for a fixed frequency", () => {
    expect(cycleMonths("monthly", 7)).toBe(1);
  });

  it("clamps an out-of-range or missing interval instead of throwing", () => {
    // The DB CHECK + zod keep these from happening; this is the last-resort
    // guard, and it must degrade to a valid cycle rather than NaN months.
    expect(cycleMonths("custom", 0)).toBe(1);
    expect(cycleMonths("custom", 999)).toBe(24);
    expect(cycleMonths("custom", null)).toBe(1);
    expect(cycleMonths("custom", undefined)).toBe(1);
  });
});

describe("nextSpawn — custom intervals", () => {
  it("advances by the chosen number of months, keeping the chosen day", () => {
    const jan = { year: 2027, month: 1, day: 15 };
    expect(nextSpawn(jan, "custom", 15, 2)).toEqual({
      year: 2027,
      month: 3,
      day: 15,
    });
    expect(nextSpawn(jan, "custom", 15, 5)).toEqual({
      year: 2027,
      month: 6,
      day: 15,
    });
  });

  it("rolls over the year boundary", () => {
    expect(nextSpawn({ year: 2027, month: 11, day: 3 }, "custom", 3, 4)).toEqual(
      { year: 2028, month: 3, day: 3 },
    );
  });

  it("clamps the chosen day to short months without the clamp sticking", () => {
    // Day 31, every 1 month: Jan 31 -> Feb 28 -> Mar 31 (the anchor, not the
    // clamped previous spawn, drives each step).
    const feb = nextSpawn({ year: 2027, month: 1, day: 31 }, "custom", 31, 1);
    expect(feb).toEqual({ year: 2027, month: 2, day: 28 });
    expect(nextSpawn(feb, "custom", 31, 1)).toEqual({
      year: 2027,
      month: 3,
      day: 31,
    });
  });
});

describe("periodKeyFor — custom", () => {
  it("keys a custom occurrence by its spawn month", () => {
    // Two occurrences of one series can never share a month (interval >= 1),
    // so YYYY-MM stays unique — which is what UNIQUE(series_id, period_key)
    // relies on to prevent double spawns.
    expect(periodKeyFor("custom", { year: 2027, month: 3, day: 15 })).toBe(
      "2027-03",
    );
    expect(periodKeyFor("custom", { year: 2027, month: 11, day: 1 })).toBe(
      "2027-11",
    );
  });
});

describe("resolveDueSpawn — custom", () => {
  it("is not due before the scheduled date", () => {
    expect(
      resolveDueSpawn({
        nextSpawnOn: { year: 2027, month: 3, day: 15 },
        frequency: "custom",
        anchorDay: 15,
        intervalMonths: 2,
        today: { year: 2027, month: 3, day: 14 },
      }),
    ).toBeNull();
  });

  it("spawns the due period and schedules the next one an interval later", () => {
    const due = resolveDueSpawn({
      nextSpawnOn: { year: 2027, month: 3, day: 15 },
      frequency: "custom",
      anchorDay: 15,
      intervalMonths: 2,
      today: { year: 2027, month: 3, day: 15 },
    });
    expect(due).toEqual({
      spawnDate: { year: 2027, month: 3, day: 15 },
      periodKey: "2027-03",
      nextSpawnOn: { year: 2027, month: 5, day: 15 },
    });
  });

  it("skips missed cycles instead of backfilling them", () => {
    // Scheduled in March, cron did not run until August: ONE occurrence (the
    // latest due period, July), never five.
    const due = resolveDueSpawn({
      nextSpawnOn: { year: 2027, month: 3, day: 15 },
      frequency: "custom",
      anchorDay: 15,
      intervalMonths: 2,
      today: { year: 2027, month: 8, day: 2 },
    });
    expect(due?.spawnDate).toEqual({ year: 2027, month: 7, day: 15 });
    expect(due?.periodKey).toBe("2027-07");
    expect(due?.nextSpawnOn).toEqual({ year: 2027, month: 9, day: 15 });
  });
});
