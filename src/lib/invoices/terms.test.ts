import { describe, it, expect } from "vitest";
import {
  normalizeDueDays,
  dueDateFrom,
  todayIsoDay,
  DUE_DAYS_DEFAULT,
  DUE_DAYS_MAX,
} from "./terms";

describe("normalizeDueDays", () => {
  // null is a real setting ("don't date my invoices"), NOT missing input, so it
  // must survive rather than falling back to the default.
  it("passes null through", () => {
    expect(normalizeDueDays(null)).toBeNull();
    expect(normalizeDueDays(undefined)).toBeNull();
  });

  it("keeps a sane value", () => {
    expect(normalizeDueDays(30)).toBe(30);
    expect(normalizeDueDays(15)).toBe(15);
  });

  // Zero means due on receipt. It must not be treated as "unset".
  it("keeps zero", () => {
    expect(normalizeDueDays(0)).toBe(0);
  });

  it("clamps out of bounds instead of trusting it", () => {
    expect(normalizeDueDays(-10)).toBe(0);
    expect(normalizeDueDays(99999)).toBe(DUE_DAYS_MAX);
  });

  it("rounds a fractional value", () => {
    expect(normalizeDueDays(30.4)).toBe(30);
    expect(normalizeDueDays(30.6)).toBe(31);
  });

  it("falls back to the default on NaN rather than producing an invalid date", () => {
    expect(normalizeDueDays(NaN)).toBe(DUE_DAYS_DEFAULT);
  });
});

describe("dueDateFrom", () => {
  it("adds the days", () => {
    expect(dueDateFrom("2026-08-03", 30)).toBe("2026-09-02");
    expect(dueDateFrom("2026-01-01", 15)).toBe("2026-01-16");
  });

  it("returns the issue day itself for due-on-receipt", () => {
    expect(dueDateFrom("2026-08-03", 0)).toBe("2026-08-03");
  });

  it("is null when the firm has no default", () => {
    expect(dueDateFrom("2026-08-03", null)).toBeNull();
    expect(dueDateFrom("2026-08-03", undefined)).toBeNull();
  });

  it("rolls over month and year ends", () => {
    expect(dueDateFrom("2026-12-20", 30)).toBe("2027-01-19");
    expect(dueDateFrom("2026-01-31", 1)).toBe("2026-02-01");
  });

  // 2028 is a leap year; 29 February has to exist for this to come out right.
  it("handles a leap year", () => {
    expect(dueDateFrom("2028-02-28", 1)).toBe("2028-02-29");
    expect(dueDateFrom("2028-02-28", 2)).toBe("2028-03-01");
    expect(dueDateFrom("2027-02-28", 1)).toBe("2027-03-01");
  });

  // The whole reason this does UTC arithmetic on the day string rather than
  // new Date() + setDate: a local timezone must not shift the answer.
  it("is unaffected by the time part of a fuller timestamp", () => {
    expect(dueDateFrom("2026-08-03T23:59:59Z", 1)).toBe("2026-08-04");
    expect(dueDateFrom("2026-08-03T00:00:00Z", 1)).toBe("2026-08-04");
  });

  it("returns null for an unparseable day rather than an Invalid Date", () => {
    expect(dueDateFrom("not-a-date", 30)).toBeNull();
    expect(dueDateFrom("", 30)).toBeNull();
  });
});

describe("todayIsoDay", () => {
  it("is the UTC day", () => {
    expect(todayIsoDay(new Date("2026-08-03T23:30:00Z"))).toBe("2026-08-03");
    expect(todayIsoDay(new Date("2026-08-04T00:30:00Z"))).toBe("2026-08-04");
  });
});
