import { describe, it, expect } from "vitest";
import {
  dayWindow,
  mapGoogleEvent,
  offsetMinutes,
  type GoogleEventLike,
} from "./day-window";
import { isCalendarAccessTokenStale } from "./google/oauth";

const MONTREAL = "America/Toronto";

describe("offsetMinutes", () => {
  it("reads the summer and winter offsets for Quebec", () => {
    // EDT in August, EST in January — read from the platform, never a table.
    expect(offsetMinutes(MONTREAL, new Date("2026-08-03T16:00:00Z"))).toBe(-240);
    expect(offsetMinutes(MONTREAL, new Date("2026-01-15T16:00:00Z"))).toBe(-300);
  });

  it("is zero for UTC", () => {
    expect(offsetMinutes("UTC", new Date("2026-08-03T16:00:00Z"))).toBe(0);
  });
});

describe("dayWindow", () => {
  // THE BUG THIS EXISTS TO PREVENT: sending naive UTC midnight would ask
  // Google for Aug 3 00:00–24:00 UTC, which in Montreal is 8pm Aug 2 to 8pm
  // Aug 3 — so an evening meeting silently belongs to the wrong day, exactly
  // the class of error the dashboard greeting's date already hit once.
  it("asks for local midnight-to-midnight, not UTC midnight", () => {
    const w = dayWindow("2026-08-03", MONTREAL);
    expect(w.timeMin).toBe("2026-08-03T04:00:00.000Z");
    expect(w.timeMax).toBe("2026-08-04T04:00:00.000Z");
  });

  it("uses the offset of THAT day, not today", () => {
    // A winter day must use EST (-05:00) even though the code may run in
    // summer — the probe is taken at that day's local noon.
    const w = dayWindow("2026-01-15", MONTREAL);
    expect(w.timeMin).toBe("2026-01-15T05:00:00.000Z");
    expect(w.timeMax).toBe("2026-01-16T05:00:00.000Z");
  });

  it("spans exactly 24 hours on an ordinary day", () => {
    const w = dayWindow("2026-08-03", MONTREAL);
    const hours =
      (Date.parse(w.timeMax) - Date.parse(w.timeMin)) / 3_600_000;
    expect(hours).toBe(24);
  });

  it("handles a UTC firm plainly", () => {
    const w = dayWindow("2026-08-03", "UTC");
    expect(w.timeMin).toBe("2026-08-03T00:00:00.000Z");
    expect(w.timeMax).toBe("2026-08-04T00:00:00.000Z");
  });

  it("degrades to a UTC day rather than throwing on a malformed date", () => {
    // Called inside a dashboard render — an exception here would take the
    // whole Overview down to fix a panel.
    expect(() => dayWindow("not-a-day", MONTREAL)).not.toThrow();
  });
});

describe("mapGoogleEvent", () => {
  const timed: GoogleEventLike = {
    id: "ev1",
    status: "confirmed",
    summary: "Onboarding call — Luna Arcuri",
    htmlLink: "https://calendar.google.com/event?eid=abc",
    start: { dateTime: "2026-08-03T09:30:00-04:00" },
    end: { dateTime: "2026-08-03T10:00:00-04:00" },
  };

  it("maps a timed event", () => {
    const m = mapGoogleEvent(timed);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("ev1");
    expect(m!.title).toBe("Onboarding call — Luna Arcuri");
    expect(m!.allDay).toBe(false);
    expect(m!.href).toContain("calendar.google.com");
  });

  it("marks an all-day entry", () => {
    const m = mapGoogleEvent({
      id: "ev2",
      summary: "Statutory holiday",
      start: { date: "2026-08-03" },
      end: { date: "2026-08-04" },
    });
    expect(m!.allDay).toBe(true);
  });

  it("drops cancelled events", () => {
    // Showing a meeting somebody called off is worse than showing nothing.
    expect(mapGoogleEvent({ ...timed, status: "cancelled" })).toBeNull();
  });

  it("keeps an untitled event rather than losing a real meeting", () => {
    const m = mapGoogleEvent({ ...timed, summary: "   " });
    expect(m!.title).toBe("(no title)");
  });

  it("returns null for junk instead of throwing", () => {
    // One malformed entry must never blank the whole agenda.
    expect(mapGoogleEvent({} as GoogleEventLike)).toBeNull();
    expect(mapGoogleEvent({ id: "x" } as GoogleEventLike)).toBeNull();
    expect(
      mapGoogleEvent(null as unknown as GoogleEventLike),
    ).toBeNull();
  });
});

describe("isCalendarAccessTokenStale", () => {
  const now = Date.parse("2026-08-03T12:00:00Z");
  it("is stale when unset or past", () => {
    expect(isCalendarAccessTokenStale(null, now)).toBe(true);
    expect(isCalendarAccessTokenStale("2026-08-03T11:59:00Z", now)).toBe(true);
  });
  it("is fresh when in the future", () => {
    expect(isCalendarAccessTokenStale("2026-08-03T12:30:00Z", now)).toBe(false);
  });
  it("treats an unparseable expiry as stale", () => {
    expect(isCalendarAccessTokenStale("soon", now)).toBe(true);
  });
});
