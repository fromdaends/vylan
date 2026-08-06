import { describe, it, expect } from "vitest";
import {
  computeBoardStats,
  formatHoursShort,
  formatMinutes,
} from "./board-stats";

const card = (budgetMinutes: number | null, actualMinutes: number) => ({
  budgetMinutes,
  actualMinutes,
});

describe("computeBoardStats", () => {
  it("counts and sums the cards it is given", () => {
    const s = computeBoardStats([card(360, 210), card(120, 60)]);
    expect(s.workItems).toBe(2);
    expect(s.budgetMinutes).toBe(480);
    expect(s.actualMinutes).toBe(270);
    expect(s.remainingMinutes).toBe(210);
  });

  it("counts an unbudgeted card as work without inventing a budget", () => {
    const s = computeBoardStats([card(null, 90)]);
    expect(s.workItems).toBe(1);
    expect(s.budgetMinutes).toBe(0);
    expect(s.actualMinutes).toBe(90);
  });

  it("KEEPS a negative remaining — an overrun is the point", () => {
    const s = computeBoardStats([card(60, 200)]);
    expect(s.remainingMinutes).toBe(-140);
  });

  it("⚠️ shows NO money without the rates capability", () => {
    // Staff must never see a rate or a labour-cost number. A dollar total is
    // one subtraction away from both.
    const s = computeBoardStats([card(600, 300)]);
    expect(s.budgetCents).toBeNull();
    expect(s.actualCents).toBeNull();
    expect(s.remainingCents).toBeNull();
  });

  it("converts hours to money when the viewer may see it", () => {
    // 10h budget, 5h actual, at $165/h.
    const s = computeBoardStats([card(600, 300)], 16_500);
    expect(s.budgetCents).toBe(165_000);
    expect(s.actualCents).toBe(82_500);
    expect(s.remainingCents).toBe(82_500);
  });

  it("is zero-everything on an empty board rather than throwing", () => {
    const s = computeBoardStats([]);
    expect(s).toMatchObject({ workItems: 0, budgetMinutes: 0, actualMinutes: 0 });
  });
});

describe("formatMinutes", () => {
  it("writes hours and minutes the way the card footer does", () => {
    expect(formatMinutes(360)).toBe("6h");
    expect(formatMinutes(210)).toBe("3h 30m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
  });

  it("says — for null rather than 0h", () => {
    // "0h planned" is a claim nobody made; "—" is the honest one.
    expect(formatMinutes(null)).toBe("—");
  });

  it("marks an overrun as negative", () => {
    expect(formatMinutes(-90)).toBe("−1h 30m");
  });
});

describe("formatHoursShort", () => {
  it("rounds to whole hours for the header suffix", () => {
    expect(formatHoursShort(4620)).toBe("77h");
    expect(formatHoursShort(0)).toBe("0h");
    expect(formatHoursShort(-120)).toBe("−2h");
  });
});
