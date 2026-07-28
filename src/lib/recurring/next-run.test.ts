import { describe, it, expect } from "vitest";
import { nextRunLabel, nextRunIsImminent } from "./next-run";

const TODAY = { year: 2026, month: 8, day: 11 };

describe("nextRunLabel", () => {
  it("says today when the schedule fires today", () => {
    expect(
      nextRunLabel({ nextSpawnOn: "2026-08-11", today: TODAY, status: "active" }),
    ).toEqual({ kind: "today" });
  });

  it("says tomorrow at exactly one day out", () => {
    expect(
      nextRunLabel({ nextSpawnOn: "2026-08-12", today: TODAY, status: "active" }),
    ).toEqual({ kind: "tomorrow" });
  });

  it("counts days inside a week", () => {
    expect(
      nextRunLabel({ nextSpawnOn: "2026-08-15", today: TODAY, status: "active" }),
    ).toEqual({ kind: "in_days", days: 4 });
  });

  it("switches to a date past a week, where a countdown stops being useful", () => {
    expect(
      nextRunLabel({ nextSpawnOn: "2026-09-27", today: TODAY, status: "active" }),
    ).toEqual({ kind: "on_date", date: "2026-09-27" });
  });

  it("uses the 7-day boundary inclusively", () => {
    expect(
      nextRunLabel({ nextSpawnOn: "2026-08-18", today: TODAY, status: "active" }),
    ).toEqual({ kind: "in_days", days: 7 });
    expect(
      nextRunLabel({ nextSpawnOn: "2026-08-19", today: TODAY, status: "active" }),
    ).toEqual({ kind: "on_date", date: "2026-08-19" });
  });

  it("treats a passed date as due-now, never as an error", () => {
    // The cron runs hourly, so this is a short window, not a fault.
    expect(
      nextRunLabel({ nextSpawnOn: "2026-08-09", today: TODAY, status: "active" }),
    ).toEqual({ kind: "due_now" });
  });

  it("NEVER shows a paused schedule's stale date — this is the lie it exists to stop", () => {
    // pauseSeriesAction doesn't touch next_spawn_on, so a paused row's stored
    // date is usually in the past. Rendering it would promise work that is
    // never coming.
    expect(
      nextRunLabel({ nextSpawnOn: "2026-01-15", today: TODAY, status: "paused" }),
    ).toEqual({ kind: "paused" });
    // Even a FUTURE date on a paused series must not be shown.
    expect(
      nextRunLabel({ nextSpawnOn: "2026-12-01", today: TODAY, status: "paused" }),
    ).toEqual({ kind: "paused" });
  });

  it("reports a stopped schedule as stopped regardless of its date", () => {
    expect(
      nextRunLabel({ nextSpawnOn: "2026-12-01", today: TODAY, status: "ended" }),
    ).toEqual({ kind: "stopped" });
  });

  it("degrades to unknown on an unparseable date instead of throwing", () => {
    expect(
      nextRunLabel({ nextSpawnOn: "not-a-date", today: TODAY, status: "active" }),
    ).toEqual({ kind: "unknown" });
  });

  it("crosses a month boundary without drifting a day", () => {
    expect(
      nextRunLabel({
        nextSpawnOn: "2026-09-01",
        today: { year: 2026, month: 8, day: 31 },
        status: "active",
      }),
    ).toEqual({ kind: "tomorrow" });
  });

  it("crosses a year boundary without drifting a day", () => {
    expect(
      nextRunLabel({
        nextSpawnOn: "2027-01-01",
        today: { year: 2026, month: 12, day: 31 },
        status: "active",
      }),
    ).toEqual({ kind: "tomorrow" });
  });

  it("handles a leap day without drifting", () => {
    expect(
      nextRunLabel({
        nextSpawnOn: "2028-03-01",
        today: { year: 2028, month: 2, day: 29 },
        status: "active",
      }),
    ).toEqual({ kind: "tomorrow" });
  });
});

describe("nextRunIsImminent", () => {
  it("flags only now-ish states", () => {
    expect(nextRunIsImminent({ kind: "today" })).toBe(true);
    expect(nextRunIsImminent({ kind: "tomorrow" })).toBe(true);
    expect(nextRunIsImminent({ kind: "due_now" })).toBe(true);
  });

  it("does NOT flag a schedule that is simply running normally", () => {
    // Styling healthy rows as urgent is the reflex this guards against.
    expect(nextRunIsImminent({ kind: "in_days", days: 5 })).toBe(false);
    expect(nextRunIsImminent({ kind: "on_date", date: "2026-12-01" })).toBe(false);
    expect(nextRunIsImminent({ kind: "paused" })).toBe(false);
    expect(nextRunIsImminent({ kind: "stopped" })).toBe(false);
  });
});
