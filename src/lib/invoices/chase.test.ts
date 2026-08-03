import { describe, it, expect } from "vitest";
import {
  buildChasePlan,
  normalizeChaseSettings,
  DEFAULT_CHASE_SETTINGS,
  CHASE_INTERVAL_MAX,
  CHASE_MAX_MAX,
} from "./chase";

const NOW = new Date("2026-08-03T00:00:00Z");

describe("normalizeChaseSettings", () => {
  it("supplies the shipped defaults for an empty row", () => {
    expect(normalizeChaseSettings(null)).toEqual(DEFAULT_CHASE_SETTINGS);
    expect(normalizeChaseSettings({})).toEqual(DEFAULT_CHASE_SETTINGS);
  });

  it("defaults chasing ON — only an explicit false turns it off", () => {
    expect(normalizeChaseSettings({}).enabledDefault).toBe(true);
    expect(normalizeChaseSettings({ enabledDefault: false }).enabledDefault).toBe(
      false,
    );
  });

  // A value out of bounds can only come from a hand-edited row or a bound that
  // was tightened after the fact. Clamping means it can never queue 400 emails.
  it("clamps out-of-bounds values instead of trusting them", () => {
    expect(normalizeChaseSettings({ intervalDays: 0 }).intervalDays).toBe(1);
    expect(normalizeChaseSettings({ intervalDays: 9999 }).intervalDays).toBe(
      CHASE_INTERVAL_MAX,
    );
    expect(normalizeChaseSettings({ maxReminders: -5 }).maxReminders).toBe(1);
    expect(normalizeChaseSettings({ maxReminders: 500 }).maxReminders).toBe(
      CHASE_MAX_MAX,
    );
  });

  it("survives a NaN without producing a NaN date later", () => {
    expect(normalizeChaseSettings({ intervalDays: NaN }).intervalDays).toBe(1);
  });
});

describe("buildChasePlan", () => {
  it("puts the first reminder on the due date, then every interval", () => {
    const plan = buildChasePlan({
      issuedOn: "2026-08-01",
      dueDate: "2026-08-31",
      settings: { enabledDefault: true, intervalDays: 7, maxReminders: 4 },
      now: NOW,
    });
    expect(plan).toHaveLength(4);
    expect(plan.map((p) => p.runAfter.toISOString().slice(0, 10))).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
    ]);
    expect(plan.map((p) => p.occurrence)).toEqual([1, 2, 3, 4]);
  });

  it("respects a lower maximum", () => {
    const plan = buildChasePlan({
      issuedOn: "2026-08-01",
      dueDate: "2026-08-31",
      settings: { enabledDefault: true, intervalDays: 7, maxReminders: 1 },
      now: NOW,
    });
    expect(plan).toHaveLength(1);
  });

  // An invoice with no due date is "due on receipt", but chasing it the moment
  // it is issued would be rude. It gets the same grace a dated invoice's terms
  // would have given it.
  it("gives an undated invoice one interval of grace", () => {
    const plan = buildChasePlan({
      issuedOn: "2026-08-03",
      dueDate: null,
      settings: { enabledDefault: true, intervalDays: 7, maxReminders: 2 },
      now: NOW,
    });
    expect(plan.map((p) => p.runAfter.toISOString().slice(0, 10))).toEqual([
      "2026-08-10",
      "2026-08-17",
    ]);
  });

  // The failure this guards against is real and loud: back-date a due date and
  // a naive plan queues every reminder with a past timestamp, so the next cron
  // tick fires all four at once. The client gets four emails in a minute.
  it("drops entries already in the past", () => {
    const plan = buildChasePlan({
      issuedOn: "2026-05-01",
      dueDate: "2026-05-15",
      settings: { enabledDefault: true, intervalDays: 7, maxReminders: 4 },
      now: NOW,
    });
    expect(plan).toEqual([]);
  });

  it("keeps only the future half of a partly-elapsed cadence", () => {
    const plan = buildChasePlan({
      issuedOn: "2026-07-01",
      dueDate: "2026-07-27",
      settings: { enabledDefault: true, intervalDays: 7, maxReminders: 4 },
      now: NOW,
    });
    // Reminders go at 09:00Z, so relative to midnight on 3 August only the
    // 27 July one has genuinely passed. Today's still has nine hours to run.
    expect(plan.map((p) => p.runAfter.toISOString().slice(0, 10))).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
    ]);
    // Occurrence numbers stay true to the original cadence, so the second
    // reminder is still labelled the second.
    expect(plan.map((p) => p.occurrence)).toEqual([2, 3, 4]);
  });

  it("returns nothing for an unparseable date rather than an Invalid Date job", () => {
    const plan = buildChasePlan({
      issuedOn: "not-a-date",
      dueDate: "also-not-a-date",
      settings: DEFAULT_CHASE_SETTINGS,
      now: NOW,
    });
    expect(plan).toEqual([]);
  });
});
