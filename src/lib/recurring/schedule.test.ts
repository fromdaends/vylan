import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  dueDateFor,
  isRecurringFrequency,
  localToday,
  nextSpawn,
  parseIsoDate,
  periodKeyFor,
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

describe("isRecurringFrequency", () => {
  it("accepts the three frequencies and nothing else", () => {
    expect(isRecurringFrequency("monthly")).toBe(true);
    expect(isRecurringFrequency("quarterly")).toBe(true);
    expect(isRecurringFrequency("yearly")).toBe(true);
    expect(isRecurringFrequency("off")).toBe(false);
    expect(isRecurringFrequency("weekly")).toBe(false);
  });
});
