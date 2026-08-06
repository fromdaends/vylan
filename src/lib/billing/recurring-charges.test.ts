import { describe, expect, it } from "vitest";
import {
  chargeDescription,
  chargePeriodKey,
  isChargeFrequency,
  nextChargeDate,
  resolveDueCharge,
} from "./recurring-charges";

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe("nextChargeDate", () => {
  it("advances a month and re-applies the anchor", () => {
    expect(nextChargeDate(d(2026, 1, 15), "monthly", 15)).toEqual(
      d(2026, 2, 15),
    );
  });

  it("clamps a day-31 anchor into February and UNCLAMPS in March", () => {
    // The bug this guards: deriving the anchor from the previous (clamped)
    // date makes a 31st schedule stick on the 28th for the rest of time.
    const feb = nextChargeDate(d(2026, 1, 31), "monthly", 31);
    expect(feb).toEqual(d(2026, 2, 28));
    expect(nextChargeDate(feb, "monthly", 31)).toEqual(d(2026, 3, 31));
  });

  it("knows February has 29 days in a leap year", () => {
    expect(nextChargeDate(d(2028, 1, 31), "monthly", 31)).toEqual(
      d(2028, 2, 29),
    );
  });

  it("rolls the year over", () => {
    expect(nextChargeDate(d(2026, 12, 1), "monthly", 1)).toEqual(d(2027, 1, 1));
  });

  it("advances a quarter and a year", () => {
    expect(nextChargeDate(d(2026, 11, 1), "quarterly", 1)).toEqual(
      d(2027, 2, 1),
    );
    expect(nextChargeDate(d(2026, 2, 29), "yearly", 29)).toEqual(d(2027, 2, 28));
  });

  it("advances weekly by seven days, across a month and a year boundary", () => {
    expect(nextChargeDate(d(2026, 8, 5), "weekly", 1)).toEqual(d(2026, 8, 12));
    expect(nextChargeDate(d(2026, 8, 28), "weekly", 1)).toEqual(d(2026, 9, 4));
    expect(nextChargeDate(d(2026, 12, 30), "weekly", 1)).toEqual(d(2027, 1, 6));
  });

  it("ignores the anchor day entirely when weekly", () => {
    // Weekly has no month to clamp against; the weekday must be preserved.
    expect(nextChargeDate(d(2026, 8, 5), "weekly", 31)).toEqual(d(2026, 8, 12));
  });
});

describe("chargePeriodKey", () => {
  it("keys monthly by year-month, quarterly by quarter, yearly by year", () => {
    expect(chargePeriodKey("monthly", d(2026, 8, 5))).toBe("2026-08");
    expect(chargePeriodKey("quarterly", d(2026, 8, 5))).toBe("2026-Q3");
    expect(chargePeriodKey("quarterly", d(2026, 12, 31))).toBe("2026-Q4");
    expect(chargePeriodKey("yearly", d(2026, 8, 5))).toBe("2026");
  });

  it("gives every day of one week the same weekly key", () => {
    // Mon 2026-08-03 .. Sun 2026-08-09 are all week 32.
    for (let day = 3; day <= 9; day += 1) {
      expect(chargePeriodKey("weekly", d(2026, 8, day))).toBe("2026-W32");
    }
    expect(chargePeriodKey("weekly", d(2026, 8, 10))).toBe("2026-W33");
  });

  it("uses the ISO WEEK-YEAR, not the calendar year", () => {
    // 2027-01-01 is a Friday: ISO week 53 of 2026. Keying it as 2027-W53 would
    // collide with a genuinely different week and let one of them bill twice.
    expect(chargePeriodKey("weekly", d(2027, 1, 1))).toBe("2026-W53");
    expect(chargePeriodKey("weekly", d(2027, 1, 4))).toBe("2027-W01");
  });
});

describe("resolveDueCharge", () => {
  const base = { frequency: "monthly" as const, anchorDay: 1 };

  it("is not due before its date", () => {
    expect(
      resolveDueCharge({
        ...base,
        nextChargeOn: d(2026, 9, 1),
        today: d(2026, 8, 31),
      }),
    ).toBeNull();
  });

  it("is due on the day", () => {
    const due = resolveDueCharge({
      ...base,
      nextChargeOn: d(2026, 8, 1),
      today: d(2026, 8, 1),
    });
    expect(due).toEqual({
      chargeDate: d(2026, 8, 1),
      periodKey: "2026-08",
      nextChargeOn: d(2026, 9, 1),
    });
  });

  it("NEVER skips a missed period — it bills the oldest one first", () => {
    // The whole difference from resolveDueSpawn. Three months unbilled must
    // produce March, then April, then May — not "May, and forget the rest".
    const due = resolveDueCharge({
      ...base,
      nextChargeOn: d(2026, 3, 1),
      today: d(2026, 5, 20),
    });
    expect(due?.periodKey).toBe("2026-03");
    expect(due?.nextChargeOn).toEqual(d(2026, 4, 1));
  });

  it("drains a backlog one period per call, in order", () => {
    let next = d(2026, 3, 1);
    const billed: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const due = resolveDueCharge({ ...base, nextChargeOn: next, today: d(2026, 5, 20) });
      if (!due) break;
      billed.push(due.periodKey);
      next = due.nextChargeOn;
    }
    expect(billed).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("stops at the end date", () => {
    expect(
      resolveDueCharge({
        ...base,
        nextChargeOn: d(2026, 8, 1),
        today: d(2026, 8, 1),
        endsOn: d(2026, 7, 31),
      }),
    ).toBeNull();
  });

  it("still bills the period that lands ON the end date", () => {
    const due = resolveDueCharge({
      ...base,
      nextChargeOn: d(2026, 8, 1),
      today: d(2026, 8, 5),
      endsOn: d(2026, 8, 1),
    });
    expect(due?.periodKey).toBe("2026-08");
  });

  it("does not treat a null end date as an end", () => {
    const due = resolveDueCharge({
      ...base,
      nextChargeOn: d(2026, 8, 1),
      today: d(2026, 8, 1),
      endsOn: null,
    });
    expect(due?.periodKey).toBe("2026-08");
  });
});

describe("isChargeFrequency", () => {
  it("accepts the four block frequencies and nothing else", () => {
    for (const f of ["weekly", "monthly", "quarterly", "yearly"]) {
      expect(isChargeFrequency(f)).toBe(true);
    }
    // "once" is not a schedule — a block that bills once has none.
    for (const f of ["once", "custom", "fortnightly", null, undefined, 3]) {
      expect(isChargeFrequency(f)).toBe(false);
    }
  });
});

describe("chargeDescription", () => {
  it("names the period so three identical invoices can be told apart", () => {
    expect(chargeDescription("Monthly bookkeeping", "2026-08")).toBe(
      "Monthly bookkeeping — 2026-08",
    );
  });

  it("falls back to the period alone when there is no name", () => {
    expect(chargeDescription("   ", "2026-08")).toBe("2026-08");
  });
});
