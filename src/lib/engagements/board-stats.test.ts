import { describe, it, expect } from "vitest";
import {
  computeBoardStats,
  formatHoursShort,
  formatMinutes,
  resolveBudgetMinutes,
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
    // NULL, not 0 — see "the stats bar must not invent an overrun" below.
    expect(s.budgetMinutes).toBeNull();
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

  it("is empty rather than throwing on a board with no cards", () => {
    const s = computeBoardStats([]);
    expect(s).toMatchObject({
      workItems: 0,
      actualMinutes: 0,
      // No cards means no budget to state, which is the same "—" a board of
      // untimed services shows.
      budgetMinutes: null,
      remainingMinutes: null,
    });
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

describe("resolveBudgetMinutes — the catalogue proposes, the engagement may differ", () => {
  it("sums the durations of the services actually picked", () => {
    expect(
      resolveBudgetMinutes({ overrideMinutes: null, serviceMinutes: [120, 240] }),
    ).toBe(360);
  });

  it("lets an engagement-level override win outright", () => {
    // Somebody looked at this particular job and disagreed with the sum.
    expect(
      resolveBudgetMinutes({ overrideMinutes: 90, serviceMinutes: [120, 240] }),
    ).toBe(90);
  });

  it("honours an override of zero rather than falling through to the sum", () => {
    // 0 is a real statement ("this one is free of time"), and `?? ` would have
    // treated it as absent.
    expect(
      resolveBudgetMinutes({ overrideMinutes: 0, serviceMinutes: [120] }),
    ).toBe(0);
  });

  it("⚠️ returns NULL, not 0, when nothing knows the duration", () => {
    // 0h would say the work takes no time and would inflate the board's
    // Remaining as though capacity had been freed.
    expect(
      resolveBudgetMinutes({ overrideMinutes: null, serviceMinutes: [] }),
    ).toBeNull();
    expect(
      resolveBudgetMinutes({ overrideMinutes: null, serviceMinutes: [null, null] }),
    ).toBeNull();
  });

  it("still totals when only some services are timed", () => {
    // A partial plan beats no plan, and refusing to total would hide the
    // catalogue work already done.
    expect(
      resolveBudgetMinutes({ overrideMinutes: null, serviceMinutes: [120, null] }),
    ).toBe(120);
  });
});

describe("⚠️ the stats bar must not invent an overrun", () => {
  it("says NOTHING for budget and remaining when no card is budgeted", () => {
    // Found by running the real board against production: with no service
    // durations filled in, the bar read "Budget 0m · Remaining −17h 55m" in
    // red — "you are eighteen hours over budget" when the truth was "nobody
    // has set a budget". Hours worked are still real and still shown.
    const s = computeBoardStats([card(null, 300), card(null, 780)]);
    expect(s.budgetMinutes).toBeNull();
    expect(s.remainingMinutes).toBeNull();
    expect(s.actualMinutes).toBe(1080);
    expect(s.workItems).toBe(2);
  });

  it("totals only the budgeted cards, and still subtracts ALL the work", () => {
    // Mixed board: one job planned, one not. The plan is 6h; the work done
    // across both is 8h. Remaining is genuinely negative and must stay so.
    const s = computeBoardStats([card(360, 300), card(null, 180)]);
    expect(s.budgetMinutes).toBe(360);
    expect(s.remainingMinutes).toBe(-120);
  });

  it("keeps a real overrun visible", () => {
    const s = computeBoardStats([card(60, 200)]);
    expect(s.remainingMinutes).toBe(-140);
  });

  it("shows no money for a budget that does not exist", () => {
    const s = computeBoardStats([card(null, 60)], 16_500);
    expect(s.budgetCents).toBeNull();
    expect(s.remainingCents).toBeNull();
    // Work actually done still has a value.
    expect(s.actualCents).toBe(16_500);
  });
});
