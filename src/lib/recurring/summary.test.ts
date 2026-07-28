import { describe, it, expect } from "vitest";
import {
  scheduleSentence,
  dueSentence,
  anchorNeedsShortMonthNote,
} from "./summary";

describe("scheduleSentence", () => {
  it("describes the three fixed frequencies", () => {
    expect(scheduleSentence({ frequency: "monthly", anchorDay: 15 })).toEqual({
      key: "repeats_monthly_on",
      params: { day: 15 },
    });
    expect(scheduleSentence({ frequency: "quarterly", anchorDay: 1 })).toEqual({
      key: "repeats_quarterly_on",
      params: { day: 1 },
    });
    expect(scheduleSentence({ frequency: "yearly", anchorDay: 30 })).toEqual({
      key: "repeats_yearly_on",
      params: { day: 30 },
    });
  });

  it("describes a custom interval", () => {
    expect(
      scheduleSentence({ frequency: "custom", intervalMonths: 2, anchorDay: 1 }),
    ).toEqual({ key: "repeats_custom_on", params: { months: 2, day: 1 } });
  });

  it("carries the interval at both DB bounds", () => {
    expect(
      scheduleSentence({ frequency: "custom", intervalMonths: 1, anchorDay: 5 })
        .params.months,
    ).toBe(1);
    expect(
      scheduleSentence({ frequency: "custom", intervalMonths: 24, anchorDay: 5 })
        .params.months,
    ).toBe(24);
  });

  it("falls back to 1 rather than rendering 'Every null months' on a pre-0890 read", () => {
    expect(
      scheduleSentence({ frequency: "custom", intervalMonths: null, anchorDay: 9 }),
    ).toEqual({ key: "repeats_custom_on", params: { months: 1, day: 9 } });
    expect(
      scheduleSentence({ frequency: "custom", anchorDay: 9 }).params.months,
    ).toBe(1);
  });

  it("passes the anchor day as a NUMBER so the locale can pick its own ordinal", () => {
    // French wants "1er"; baking an English ordinal here would trap it.
    const out = scheduleSentence({ frequency: "monthly", anchorDay: 1 });
    expect(typeof out.params.day).toBe("number");
  });

  it("ignores intervalMonths on a fixed frequency", () => {
    expect(
      scheduleSentence({ frequency: "monthly", intervalMonths: 7, anchorDay: 3 }),
    ).toEqual({ key: "repeats_monthly_on", params: { day: 3 } });
  });
});

describe("dueSentence", () => {
  it("carries the offset", () => {
    expect(dueSentence(15)).toEqual({ key: "due_offset", params: { days: 15 } });
  });
});

describe("anchorNeedsShortMonthNote", () => {
  it("flags only days that don't exist in every month", () => {
    expect(anchorNeedsShortMonthNote(28)).toBe(false);
    expect(anchorNeedsShortMonthNote(29)).toBe(true);
    expect(anchorNeedsShortMonthNote(31)).toBe(true);
  });
});
