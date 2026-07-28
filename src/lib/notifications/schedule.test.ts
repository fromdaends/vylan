import { describe, it, expect } from "vitest";
import {
  isWeekend,
  isWithinQuietHours,
  parseTimeOfDay,
  resolveEmailDelivery,
  zonedParts,
  zonedTimeToUtc,
  WEEKEND_RESUME_HOUR,
  type DeliverySettings,
} from "./schedule";

const TZ = "America/Toronto";

const base: DeliverySettings = {
  emailEnabled: true,
  emailMode: "instant",
  dailyDigestTime: "08:00",
  timezone: TZ,
  quietHoursEnabled: false,
  quietHoursStart: "20:00",
  quietHoursEnd: "07:00",
  pauseWeekends: false,
};

// Helper: the instant at which Toronto shows this wall-clock time.
function toronto(
  y: number,
  m: number,
  d: number,
  h: number,
  min = 0,
): Date {
  return zonedTimeToUtc(y, m, d, h, min, TZ);
}

describe("parseTimeOfDay", () => {
  it("parses HH:MM and HH:MM:SS", () => {
    expect(parseTimeOfDay("08:00")).toBe(480);
    expect(parseTimeOfDay("20:30:00")).toBe(1230);
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("23:59")).toBe(1439);
  });

  it("returns null for nonsense rather than a bogus time", () => {
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("25:00")).toBeNull();
    expect(parseTimeOfDay("08:99")).toBeNull();
    expect(parseTimeOfDay("noon")).toBeNull();
  });
});

describe("isWithinQuietHours", () => {
  it("handles a window that wraps midnight (20:00 -> 07:00)", () => {
    const start = 20 * 60;
    const end = 7 * 60;
    expect(isWithinQuietHours(22 * 60, start, end)).toBe(true); // 22:00
    expect(isWithinQuietHours(2 * 60, start, end)).toBe(true); // 02:00
    expect(isWithinQuietHours(6 * 60 + 59, start, end)).toBe(true);
    expect(isWithinQuietHours(7 * 60, start, end)).toBe(false); // end exclusive
    expect(isWithinQuietHours(12 * 60, start, end)).toBe(false);
    expect(isWithinQuietHours(19 * 60 + 59, start, end)).toBe(false);
  });

  it("handles a same-day window (09:00 -> 17:00)", () => {
    const start = 9 * 60;
    const end = 17 * 60;
    expect(isWithinQuietHours(12 * 60, start, end)).toBe(true);
    expect(isWithinQuietHours(8 * 60, start, end)).toBe(false);
    expect(isWithinQuietHours(17 * 60, start, end)).toBe(false);
  });

  it("treats a zero-length window as never quiet (fails toward delivering)", () => {
    expect(isWithinQuietHours(12 * 60, 600, 600)).toBe(false);
    expect(isWithinQuietHours(600, 600, 600)).toBe(false);
  });
});

describe("zoned time helpers", () => {
  it("round-trips a wall-clock time through the zone", () => {
    const at = toronto(2026, 7, 28, 22, 15);
    const p = zonedParts(at, TZ);
    expect(p.hour).toBe(22);
    expect(p.minute).toBe(15);
    expect(p.day).toBe(28);
  });

  it("gets the offset right on both sides of a DST change", () => {
    // 2026-01-15 is EST (UTC-5); 2026-07-15 is EDT (UTC-4).
    expect(toronto(2026, 1, 15, 12).toISOString()).toBe(
      "2026-01-15T17:00:00.000Z",
    );
    expect(toronto(2026, 7, 15, 12).toISOString()).toBe(
      "2026-07-15T16:00:00.000Z",
    );
  });

  it("identifies weekends", () => {
    // 2026-07-25 is a Saturday, 07-26 Sunday, 07-27 Monday.
    expect(isWeekend(zonedParts(toronto(2026, 7, 25, 12), TZ).weekday)).toBe(true);
    expect(isWeekend(zonedParts(toronto(2026, 7, 26, 12), TZ).weekday)).toBe(true);
    expect(isWeekend(zonedParts(toronto(2026, 7, 27, 12), TZ).weekday)).toBe(false);
  });

  it("falls back to the firm default for a garbage timezone instead of throwing", () => {
    expect(() => zonedParts(new Date(), "Not/AZone")).not.toThrow();
  });
});

describe("resolveEmailDelivery", () => {
  it("sends instantly with no constraints", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 27, 14),
      settings: base,
      bypassDeferral: false,
    });
    expect(d).toEqual({ kind: "send_now" });
  });

  it("suppresses when the master email switch is off", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 27, 14),
      settings: { ...base, emailEnabled: false },
      bypassDeferral: false,
    });
    expect(d).toEqual({ kind: "suppress", reason: "email_disabled" });
  });

  // ── Acceptance criterion 4 ────────────────────────────────────────────────
  it("quiet hours 20:00-07:00, event at 22:00 -> email lands 07:00 next morning", () => {
    const now = toronto(2026, 7, 27, 22); // Monday 22:00
    const d = resolveEmailDelivery({
      now,
      settings: { ...base, quietHoursEnabled: true },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    expect(d.reason).toBe("quiet_hours");
    const p = zonedParts(d.sendAfter, TZ);
    expect(p.hour).toBe(7);
    expect(p.minute).toBe(0);
    expect(p.day).toBe(28); // the NEXT morning
  });

  it("an event at 02:00 inside quiet hours lands at 07:00 the SAME morning", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 28, 2),
      settings: { ...base, quietHoursEnabled: true },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    const p = zonedParts(d.sendAfter, TZ);
    expect(p.hour).toBe(7);
    expect(p.day).toBe(28);
  });

  it("an event just outside quiet hours still sends now", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 28, 7, 1),
      settings: { ...base, quietHoursEnabled: true },
      bypassDeferral: false,
    });
    expect(d).toEqual({ kind: "send_now" });
  });

  // ── Acceptance criterion 5 ────────────────────────────────────────────────
  it("a locked event (failed billing) at 23:00 bypasses quiet hours entirely", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 27, 23),
      settings: {
        ...base,
        emailEnabled: false, // even with email switched off
        quietHoursEnabled: true,
        pauseWeekends: true,
        emailMode: "daily_digest",
      },
      bypassDeferral: true,
    });
    expect(d).toEqual({ kind: "send_now" });
  });

  it("hourly digest batches to the top of the next hour", () => {
    const now = toronto(2026, 7, 27, 14, 23);
    const d = resolveEmailDelivery({
      now,
      settings: { ...base, emailMode: "hourly_digest" },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    expect(d.reason).toBe("hourly_digest");
    expect(d.sendAfter.getTime()).toBe(toronto(2026, 7, 27, 15, 0).getTime());
  });

  it("daily digest batches to the next configured time", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 27, 14),
      settings: { ...base, emailMode: "daily_digest", dailyDigestTime: "08:00" },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    expect(d.reason).toBe("daily_digest");
    const p = zonedParts(d.sendAfter, TZ);
    expect(p.hour).toBe(8);
    expect(p.day).toBe(28); // 08:00 today already passed
  });

  it("daily digest earlier today schedules for later today", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 27, 6),
      settings: { ...base, emailMode: "daily_digest", dailyDigestTime: "08:00" },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    const p = zonedParts(d.sendAfter, TZ);
    expect(p.hour).toBe(8);
    expect(p.day).toBe(27);
  });

  it("weekend pause on a Saturday defers to Monday morning", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 25, 11), // Saturday
      settings: { ...base, pauseWeekends: true },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    expect(d.reason).toBe("weekend");
    const p = zonedParts(d.sendAfter, TZ);
    expect(p.weekday).toBe(1); // Monday
    expect(p.day).toBe(27);
    expect(p.hour).toBe(WEEKEND_RESUME_HOUR);
  });

  it("weekend pause on a Sunday defers to Monday, not the following week", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 26, 15), // Sunday
      settings: { ...base, pauseWeekends: true },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    const p = zonedParts(d.sendAfter, TZ);
    expect(p.day).toBe(27);
    expect(p.weekday).toBe(1);
  });

  it("weekend + quiet hours combine: Friday 23:00 lands Monday morning", () => {
    // Friday 23:00 is inside quiet hours -> 07:00 Saturday -> weekend -> Monday.
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 24, 23), // Friday
      settings: { ...base, quietHoursEnabled: true, pauseWeekends: true },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    const p = zonedParts(d.sendAfter, TZ);
    expect(p.weekday).toBe(1);
    expect(p.day).toBe(27);
    // Quiet hours are set, so Monday resumes at the user's quiet-hours end.
    expect(p.hour).toBe(7);
  });

  it("weekend resume honours the daily digest time over the default hour", () => {
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 25, 11), // Saturday
      settings: {
        ...base,
        pauseWeekends: true,
        emailMode: "daily_digest",
        dailyDigestTime: "09:30",
      },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    const p = zonedParts(d.sendAfter, TZ);
    expect(p.weekday).toBe(1);
    expect(p.hour).toBe(9);
    expect(p.minute).toBe(30);
  });

  it("respects a non-Eastern timezone", () => {
    // 22:00 in Vancouver is 01:00 Toronto — the Vancouver user's quiet hours
    // must be judged in Vancouver, not in the firm's zone.
    const vancouver = "America/Vancouver";
    const now = zonedTimeToUtc(2026, 7, 27, 22, 0, vancouver);
    const d = resolveEmailDelivery({
      now,
      settings: { ...base, timezone: vancouver, quietHoursEnabled: true },
      bypassDeferral: false,
    });
    expect(d.kind).toBe("defer");
    if (d.kind !== "defer") return;
    const p = zonedParts(d.sendAfter, vancouver);
    expect(p.hour).toBe(7);
    expect(p.day).toBe(28);
  });

  it("never loops forever on self-contradictory settings", () => {
    // Quiet hours covering the entire day, plus a weekend pause.
    const d = resolveEmailDelivery({
      now: toronto(2026, 7, 27, 12),
      settings: {
        ...base,
        quietHoursEnabled: true,
        quietHoursStart: "00:01",
        quietHoursEnd: "00:00",
        pauseWeekends: true,
      },
      bypassDeferral: false,
    });
    // It must terminate with SOMETHING rather than hang or throw.
    expect(["defer", "send_now"]).toContain(d.kind);
  });
});
