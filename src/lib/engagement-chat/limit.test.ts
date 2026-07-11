import { describe, expect, it } from "vitest";
import { computeChatLimitState } from "./limit";
import { CHAT_MESSAGE_LIMIT } from "./config";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-07-11T12:00:00.000Z");

function hoursAgo(h: number): string {
  return new Date(NOW - h * HOUR).toISOString();
}

describe("computeChatLimitState", () => {
  it("empty ledger: full budget, no reset time", () => {
    const s = computeChatLimitState([], NOW, 30, 36);
    expect(s).toEqual({ limit: 30, used: 0, remaining: 30, resetAt: null });
  });

  it("counts only turns inside the rolling window", () => {
    const s = computeChatLimitState(
      [hoursAgo(1), hoursAgo(35), hoursAgo(37), hoursAgo(100)],
      NOW,
      30,
      36,
    );
    expect(s.used).toBe(2);
    expect(s.remaining).toBe(28);
    expect(s.resetAt).toBeNull();
  });

  it("a turn exactly at the window edge has aged out", () => {
    const s = computeChatLimitState([hoursAgo(36)], NOW, 30, 36);
    expect(s.used).toBe(0);
  });

  it("at the limit: resetAt is the oldest in-window turn + window", () => {
    const times = Array.from({ length: 30 }, (_, i) => hoursAgo(30 - i));
    const s = computeChatLimitState(times, NOW, 30, 36);
    expect(s.used).toBe(30);
    expect(s.remaining).toBe(0);
    // Oldest in-window turn was 30h ago → frees at +6h from now.
    expect(s.resetAt).toBe(new Date(NOW + 6 * HOUR).toISOString());
  });

  it("over the limit: capacity frees when enough old turns age out", () => {
    // 32 turns in-window, limit 30 → two must age out; the freeing turn is
    // the 3rd oldest (index used - limit = 2).
    const times = [
      hoursAgo(20), // oldest
      hoursAgo(18),
      hoursAgo(16), // <- index 2: the freeing turn
      ...Array.from({ length: 29 }, (_, i) => hoursAgo(10 - i * 0.1)),
    ];
    const s = computeChatLimitState(times, NOW, 30, 36);
    expect(s.used).toBe(32);
    expect(s.remaining).toBe(0);
    expect(s.resetAt).toBe(new Date(NOW - 16 * HOUR + 36 * HOUR).toISOString());
  });

  it("order of the input does not matter", () => {
    const shuffled = [hoursAgo(3), hoursAgo(30), hoursAgo(12)];
    const a = computeChatLimitState(shuffled, NOW, 2, 36);
    const b = computeChatLimitState([...shuffled].reverse(), NOW, 2, 36);
    expect(a).toEqual(b);
    // Limit 2 with 3 in-window: freeing turn = index 1 (12h ago).
    expect(a.resetAt).toBe(new Date(NOW - 12 * HOUR + 36 * HOUR).toISOString());
  });

  it("ignores unparseable timestamps", () => {
    const s = computeChatLimitState(["not-a-date", hoursAgo(1)], NOW, 30, 36);
    expect(s.used).toBe(1);
  });

  it("defaults to the config constants (stays a one-line change)", () => {
    const s = computeChatLimitState([hoursAgo(1)], NOW);
    expect(s.limit).toBe(CHAT_MESSAGE_LIMIT);
    expect(s.remaining).toBe(CHAT_MESSAGE_LIMIT - 1);
  });
});
