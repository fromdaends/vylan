import { describe, expect, it } from "vitest";
import { isShortMonthDay, ordinalDay } from "./day-of-month";

describe("ordinalDay — English", () => {
  it("uses the right suffix for the regular cases", () => {
    expect(ordinalDay(1, "en")).toBe("1st");
    expect(ordinalDay(2, "en")).toBe("2nd");
    expect(ordinalDay(3, "en")).toBe("3rd");
    expect(ordinalDay(4, "en")).toBe("4th");
    expect(ordinalDay(25, "en")).toBe("25th");
  });

  it("handles the 11/12/13 irregulars", () => {
    // The classic bug: "11st" / "12nd" / "13rd".
    expect(ordinalDay(11, "en")).toBe("11th");
    expect(ordinalDay(12, "en")).toBe("12th");
    expect(ordinalDay(13, "en")).toBe("13th");
  });

  it("goes back to the regular suffixes in the twenties and thirties", () => {
    expect(ordinalDay(21, "en")).toBe("21st");
    expect(ordinalDay(22, "en")).toBe("22nd");
    expect(ordinalDay(23, "en")).toBe("23rd");
    expect(ordinalDay(31, "en")).toBe("31st");
  });
});

describe("ordinalDay — French", () => {
  it("marks only the first, per Quebec convention", () => {
    expect(ordinalDay(1, "fr")).toBe("1er");
    expect(ordinalDay(2, "fr")).toBe("2");
    expect(ordinalDay(21, "fr")).toBe("21");
    expect(ordinalDay(31, "fr")).toBe("31");
  });
});

describe("isShortMonthDay", () => {
  it("flags exactly the days that some months don't have", () => {
    expect(isShortMonthDay(28)).toBe(false);
    expect(isShortMonthDay(29)).toBe(true);
    expect(isShortMonthDay(30)).toBe(true);
    expect(isShortMonthDay(31)).toBe(true);
  });
});
