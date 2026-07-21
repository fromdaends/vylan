import { describe, expect, it } from "vitest";
import { occurrenceTitle, periodLabel } from "./naming";

describe("periodLabel", () => {
  it("names monthly periods in both languages", () => {
    const march = { year: 2027, month: 3, day: 1 };
    expect(periodLabel("monthly", march, "en")).toBe("March 2027");
    // fr-CA lowercases month names (Quebec French convention).
    expect(periodLabel("monthly", march, "fr")).toBe("mars 2027");
  });

  it("names quarterly periods with Q (EN) and T for trimestre (FR)", () => {
    const q1 = { year: 2027, month: 2, day: 15 };
    expect(periodLabel("quarterly", q1, "en")).toBe("Q1 2027");
    expect(periodLabel("quarterly", q1, "fr")).toBe("T1 2027");
    const q4 = { year: 2027, month: 12, day: 1 };
    expect(periodLabel("quarterly", q4, "en")).toBe("Q4 2027");
  });

  it("names yearly periods as the bare year in both languages", () => {
    const d = { year: 2027, month: 6, day: 30 };
    expect(periodLabel("yearly", d, "en")).toBe("2027");
    expect(periodLabel("yearly", d, "fr")).toBe("2027");
  });
});

describe("occurrenceTitle", () => {
  it("stamps the base title with the period, hyphen-separated", () => {
    expect(
      occurrenceTitle(
        "Monthly bookkeeping",
        "monthly",
        { year: 2027, month: 3, day: 1 },
        "en",
      ),
    ).toBe("Monthly bookkeeping - March 2027");
    expect(
      occurrenceTitle(
        "Tenue de livres mensuelle",
        "monthly",
        { year: 2027, month: 3, day: 1 },
        "fr",
      ),
    ).toBe("Tenue de livres mensuelle - mars 2027");
  });
});
