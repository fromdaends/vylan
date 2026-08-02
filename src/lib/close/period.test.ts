import { describe, it, expect } from "vitest";
import {
  isPeriodKey,
  periodKey,
  periodStart,
  periodEnd,
  daysInMonth,
  shiftPeriod,
  periodOf,
  defaultPeriod,
  periodLabel,
} from "./period";

describe("isPeriodKey", () => {
  it("accepts a month", () => {
    expect(isPeriodKey("2026-07")).toBe(true);
    expect(isPeriodKey("2026-01")).toBe(true);
    expect(isPeriodKey("2026-12")).toBe(true);
  });

  it("rejects anything else", () => {
    // This value reaches a SQL query and a ledger date range, so it is narrowed
    // rather than trusted.
    expect(isPeriodKey("2026-13")).toBe(false);
    expect(isPeriodKey("2026-00")).toBe(false);
    expect(isPeriodKey("2026-7")).toBe(false);
    expect(isPeriodKey("2026-07-01")).toBe(false);
    expect(isPeriodKey("")).toBe(false);
    expect(isPeriodKey(null)).toBe(false);
  });
});

describe("periodStart / periodEnd", () => {
  it("covers the whole month", () => {
    expect(periodStart("2026-07")).toBe("2026-07-01");
    expect(periodEnd("2026-07")).toBe("2026-07-31");
  });

  it("ends a 30-day month on the 30th", () => {
    expect(periodEnd("2026-06")).toBe("2026-06-30");
  });

  it("ends February on the 29th in a leap year", () => {
    // A scan that stopped on the 28th would miss a day of transactions in the
    // one month nobody thinks to double-check.
    expect(periodEnd("2024-02")).toBe("2024-02-29");
    expect(periodEnd("2026-02")).toBe("2026-02-28");
  });

  it("knows the century rule", () => {
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("starts the month on the 1st, not the day before", () => {
    // The whole reason this module does string maths: a Date-based range would
    // start on 30 June for everyone west of UTC.
    expect(periodStart("2026-07").endsWith("-01")).toBe(true);
  });
});

describe("shiftPeriod", () => {
  it("moves within a year", () => {
    expect(shiftPeriod("2026-07", 1)).toBe("2026-08");
    expect(shiftPeriod("2026-07", -1)).toBe("2026-06");
  });

  it("crosses New Year in both directions", () => {
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
  });

  it("crosses several years", () => {
    expect(shiftPeriod("2026-03", -15)).toBe("2024-12");
    expect(shiftPeriod("2026-03", 22)).toBe("2028-01");
  });
});

describe("periodOf / defaultPeriod", () => {
  it("reads the month out of a date", () => {
    expect(periodOf("2026-07-03")).toBe("2026-07");
  });

  it("opens on LAST month", () => {
    // You close July during August. Opening on the current month would show a
    // month nobody can finish yet.
    expect(defaultPeriod("2026-08-02")).toBe("2026-07");
  });

  it("opens on December when it is January", () => {
    expect(defaultPeriod("2026-01-04")).toBe("2025-12");
  });

  it("still says last month on the first of the month", () => {
    expect(defaultPeriod("2026-08-01")).toBe("2026-07");
  });
});

describe("periodLabel", () => {
  it("reads as a month, in both languages", () => {
    expect(periodLabel("2026-07")).toBe("July 2026");
    expect(periodLabel("2026-07", "fr")).toBe("juillet 2026");
  });

  it("handles every month", () => {
    for (let m = 1; m <= 12; m++) {
      expect(periodLabel(periodKey(2026, m))).toMatch(/^[A-Z][a-z]+ 2026$/);
      expect(periodLabel(periodKey(2026, m), "fr")).toMatch(/ 2026$/);
    }
  });
});
