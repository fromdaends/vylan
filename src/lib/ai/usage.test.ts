import { describe, it, expect } from "vitest";
import { aiCapStatus, DEFAULT_AI_MONTHLY_CAP } from "./usage";

const now = new Date(Date.UTC(2026, 5, 7, 12, 0, 0)); // 2026-06-07 UTC

describe("aiCapStatus", () => {
  it("is not paused below the cap", () => {
    const s = aiCapStatus(399, 400, now);
    expect(s.paused).toBe(false);
    expect(s.used).toBe(399);
    expect(s.cap).toBe(400);
  });

  it("pauses at and above the cap", () => {
    expect(aiCapStatus(400, 400, now).paused).toBe(true);
    expect(aiCapStatus(450, 400, now).paused).toBe(true);
  });

  it("resets on the first day of the next UTC month (incl. year rollover)", () => {
    expect(aiCapStatus(0, 400, now).resetsAt).toBe("2026-07-01T00:00:00.000Z");
    const dec = new Date(Date.UTC(2026, 11, 20));
    expect(aiCapStatus(0, 400, dec).resetsAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("falls back to the default cap for invalid values", () => {
    expect(aiCapStatus(0, Number.NaN, now).cap).toBe(DEFAULT_AI_MONTHLY_CAP);
    expect(aiCapStatus(0, -5, now).cap).toBe(DEFAULT_AI_MONTHLY_CAP);
  });
});
