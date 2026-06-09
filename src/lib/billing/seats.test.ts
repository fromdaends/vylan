import { describe, it, expect } from "vitest";
import {
  resolveSeatCap,
  summarizeSeatUsage,
  assertSeatAvailable,
  SeatLimitError,
  UNKNOWN_PLAN_SEAT_CAP,
  hasRoomForMember,
} from "./seats";

describe("resolveSeatCap", () => {
  it("uses the plan's maxUsers when no override is set", () => {
    // Mirrors PLANS in src/lib/plans.ts — locked tiers: Solo 2 / Cabinet 6 /
    // Cabinet+ 15 (trial keeps 5).
    expect(resolveSeatCap("trial", null)).toBe(5);
    expect(resolveSeatCap("solo", null)).toBe(2);
    expect(resolveSeatCap("cabinet", null)).toBe(6);
    expect(resolveSeatCap("cabinet_plus", null)).toBe(15);
  });

  it("uses a positive override regardless of plan", () => {
    expect(resolveSeatCap("solo", 4)).toBe(4);
    expect(resolveSeatCap("cabinet", 25)).toBe(25);
  });

  it("ignores a null / zero / negative override and falls back to the plan", () => {
    expect(resolveSeatCap("cabinet", null)).toBe(6);
    expect(resolveSeatCap("cabinet", 0)).toBe(6);
    expect(resolveSeatCap("cabinet", -3)).toBe(6);
  });

  it("floors a fractional override", () => {
    expect(resolveSeatCap("solo", 3.9)).toBe(3);
  });

  it("falls back to a safe cap for an unknown / missing plan", () => {
    expect(resolveSeatCap("enterprise", null)).toBe(UNKNOWN_PLAN_SEAT_CAP);
    expect(resolveSeatCap(null, null)).toBe(UNKNOWN_PLAN_SEAT_CAP);
    expect(resolveSeatCap(undefined, undefined)).toBe(UNKNOWN_PLAN_SEAT_CAP);
  });

  it("an override still wins even on an unknown plan", () => {
    expect(resolveSeatCap("enterprise", 8)).toBe(8);
  });
});

describe("summarizeSeatUsage", () => {
  it("counts active members + pending invites toward the total", () => {
    const u = summarizeSeatUsage({ activeUsers: 3, pendingInvites: 2, cap: 10 });
    expect(u.total).toBe(5);
    expect(u.remaining).toBe(5);
  });

  it("pending invites consume remaining seats (the core seat-cap rule)", () => {
    // 5 active, cap 6 would have one seat left — but a pending invite took it.
    const u = summarizeSeatUsage({ activeUsers: 5, pendingInvites: 1, cap: 6 });
    expect(u.total).toBe(6);
    expect(u.remaining).toBe(0);
  });

  it("clamps remaining at 0 when over cap", () => {
    const u = summarizeSeatUsage({ activeUsers: 8, pendingInvites: 1, cap: 6 });
    expect(u.remaining).toBe(0);
  });

  it("treats an infinite cap as unlimited remaining", () => {
    const u = summarizeSeatUsage({
      activeUsers: 100,
      pendingInvites: 5,
      cap: Number.POSITIVE_INFINITY,
    });
    expect(u.remaining).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("assertSeatAvailable", () => {
  it("passes when there is room", () => {
    expect(() =>
      assertSeatAvailable(
        summarizeSeatUsage({ activeUsers: 2, pendingInvites: 1, cap: 6 }),
      ),
    ).not.toThrow();
  });

  it("throws SeatLimitError when full", () => {
    expect(() =>
      assertSeatAvailable(
        summarizeSeatUsage({ activeUsers: 6, pendingInvites: 0, cap: 6 }),
      ),
    ).toThrow(SeatLimitError);
  });

  it("throws (carrying the cap) when a pending invite consumed the last seat", () => {
    let err: unknown;
    try {
      assertSeatAvailable(
        summarizeSeatUsage({ activeUsers: 5, pendingInvites: 1, cap: 6 }),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SeatLimitError);
    expect((err as SeatLimitError).cap).toBe(6);
  });

  it("a solo firm (cap 1) with just the owner is already full", () => {
    expect(() =>
      assertSeatAvailable(
        summarizeSeatUsage({ activeUsers: 1, pendingInvites: 0, cap: 1 }),
      ),
    ).toThrow(SeatLimitError);
  });
});

describe("hasRoomForMember", () => {
  it("has room while active members are below the cap", () => {
    expect(
      hasRoomForMember(
        summarizeSeatUsage({ activeUsers: 1, pendingInvites: 3, cap: 6 }),
      ),
    ).toBe(true);
  });

  it("pending invites do NOT block accepting (only active members count)", () => {
    // 2 active + 4 pending = at cap by total, but there's still room to ACCEPT
    // (convert a pending invite to active) because active < cap.
    expect(
      hasRoomForMember(
        summarizeSeatUsage({ activeUsers: 2, pendingInvites: 4, cap: 6 }),
      ),
    ).toBe(true);
  });

  it("no room once active members reach the cap", () => {
    expect(
      hasRoomForMember(
        summarizeSeatUsage({ activeUsers: 6, pendingInvites: 0, cap: 6 }),
      ),
    ).toBe(false);
  });

  it("an unlimited (Infinity) cap always has room", () => {
    expect(
      hasRoomForMember(
        summarizeSeatUsage({
          activeUsers: 999,
          pendingInvites: 0,
          cap: Number.POSITIVE_INFINITY,
        }),
      ),
    ).toBe(true);
  });
});
