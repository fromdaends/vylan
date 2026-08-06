import { describe, expect, it } from "vitest";
import { schedulableFrequencies } from "./start-schedules";

const line = (over: Record<string, unknown> = {}) => ({
  name: "Bookkeeping",
  rate_cents: 40_000,
  billing_frequency: "monthly",
  ...over,
});

describe("schedulableFrequencies", () => {
  it("finds the frequency of a priced, named recurring line", () => {
    expect(schedulableFrequencies([line()])).toEqual(["monthly"]);
  });

  it("collapses three monthly services into ONE monthly schedule", () => {
    // One monthly invoice listing all three is what a firm sends — and what
    // the proposal's own totals panel already shows the client.
    expect(
      schedulableFrequencies([
        line({ name: "Bookkeeping" }),
        line({ name: "Payroll" }),
        line({ name: "Reporting" }),
      ]),
    ).toEqual(["monthly"]);
  });

  it("keeps two different frequencies apart", () => {
    const found = schedulableFrequencies([
      line({ billing_frequency: "monthly" }),
      line({ billing_frequency: "quarterly" }),
    ]);
    expect(found.sort()).toEqual(["monthly", "quarterly"]);
  });

  it("ignores one-time lines", () => {
    expect(schedulableFrequencies([line({ billing_frequency: "once" })])).toEqual(
      [],
    );
  });

  it("ignores a line with NO RATE", () => {
    // "Hourly, we'll tell you later" is a real answer on a proposal — but a
    // schedule for it would raise a $0.00 invoice every month forever, which
    // has promised the work for free.
    expect(schedulableFrequencies([line({ rate_cents: null })])).toEqual([]);
    expect(schedulableFrequencies([line({ rate_cents: 0 })])).toEqual([]);
  });

  it("ignores a blank row the accountant never filled in", () => {
    expect(schedulableFrequencies([line({ name: "   " })])).toEqual([]);
  });

  it("ignores an unrecognised frequency rather than guessing", () => {
    expect(
      schedulableFrequencies([line({ billing_frequency: "fortnightly" })]),
    ).toEqual([]);
    expect(schedulableFrequencies([line({ billing_frequency: null })])).toEqual(
      [],
    );
  });

  it("finds the good line in a list that also has bad ones", () => {
    expect(
      schedulableFrequencies([
        line({ billing_frequency: "once" }),
        line({ rate_cents: null, billing_frequency: "yearly" }),
        line({ name: "", billing_frequency: "weekly" }),
        line({ billing_frequency: "monthly" }),
      ]),
    ).toEqual(["monthly"]);
  });

  it("is empty for an engagement with no lines at all", () => {
    expect(schedulableFrequencies([])).toEqual([]);
  });
});

describe("an hourly line is never put on a schedule", () => {
  it("refuses an hourly line even when it carries a rate", () => {
    // "$150/hour" is a rate PER HOUR with no known number of hours. Scheduling
    // it bills a flat $150 every month — a figure nobody quoted, contradicting
    // the firm's own screen, which says "hourly billing determined later".
    expect(
      schedulableFrequencies([
        line({ rate_type: "hour", rate_cents: 15_000 }),
      ]),
    ).toEqual([]);
  });

  it("still accepts a fixed line, with or without an explicit rate type", () => {
    // Absent rate_type reads as 'item' — the column default, and what every row
    // written before rate types existed meant.
    expect(schedulableFrequencies([line({ rate_type: "item" })])).toEqual([
      "monthly",
    ]);
    expect(schedulableFrequencies([line({ rate_type: null })])).toEqual([
      "monthly",
    ]);
    expect(schedulableFrequencies([line()])).toEqual(["monthly"]);
  });

  it("keeps the fixed line when an hourly one sits beside it", () => {
    expect(
      schedulableFrequencies([
        line({ name: "Advisory", rate_type: "hour", rate_cents: 15_000 }),
        line({ name: "Bookkeeping", rate_type: "item", rate_cents: 40_000 }),
      ]),
    ).toEqual(["monthly"]);
  });

  it("starts NO schedule when every recurring line is hourly", () => {
    // The honest outcome: there is nothing that can be billed without a human
    // saying how many hours, so no schedule should exist to bill it.
    expect(
      schedulableFrequencies([
        line({ billing_frequency: "monthly", rate_type: "hour" }),
        line({ billing_frequency: "quarterly", rate_type: "hour" }),
      ]),
    ).toEqual([]);
  });
});
