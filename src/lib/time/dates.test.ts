import { describe, it, expect } from "vitest";
import { localDay, noonInTimeZone } from "./dates";
import { dateInTimeZone } from "@/lib/tasks/dates";

describe("localDay", () => {
  it("uses the browser's own calendar, not UTC's", () => {
    // 23:30 local on the 6th. toISOString would say the 7th anywhere west of
    // Greenwich; localDay must say the 6th.
    const evening = new Date(2026, 7, 6, 23, 30);
    expect(localDay(evening)).toBe("2026-08-06");
  });

  it("zero-pads month and day", () => {
    expect(localDay(new Date(2026, 0, 5, 9, 0))).toBe("2026-01-05");
  });
});

describe("noonInTimeZone", () => {
  it("keeps a Quebec entry on the chosen day in BOTH calendars", () => {
    const instant = noonInTimeZone("2026-08-06", "America/Toronto");
    expect(instant).not.toBeNull();
    // 12:00 EDT = 16:00 UTC — same calendar day in UTC…
    expect(instant!.toISOString()).toBe("2026-08-06T16:00:00.000Z");
    // …and, round-tripped through the app's own tz reader, the same day local.
    expect(dateInTimeZone(instant!.toISOString(), "America/Toronto")).toBe(
      "2026-08-06",
    );
  });

  it("handles the winter offset too (EST, not EDT)", () => {
    const instant = noonInTimeZone("2026-01-15", "America/Toronto");
    expect(instant!.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("works east of Greenwich", () => {
    const instant = noonInTimeZone("2026-08-06", "Europe/Paris");
    expect(instant!.toISOString()).toBe("2026-08-06T10:00:00.000Z");
  });

  it("falls back to UTC noon for an unknown zone rather than refusing", () => {
    const instant = noonInTimeZone("2026-08-06", "Not/AZone");
    expect(instant!.toISOString()).toBe("2026-08-06T12:00:00.000Z");
  });

  it("refuses malformed dates", () => {
    expect(noonInTimeZone("2026-13-40", "America/Toronto")).toBeNull();
    expect(noonInTimeZone("yesterday", "America/Toronto")).toBeNull();
  });
});
