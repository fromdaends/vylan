import { describe, it, expect } from "vitest";
import {
  addDays,
  daysForView,
  formatDayTotal,
  groupByDay,
  monthCells,
  shiftAnchor,
  startOfWeek,
  totalMinutes,
  weekDays,
  type TimeCard,
} from "./time-page";

const card = (over: Partial<TimeCard> = {}): TimeCard => ({
  id: Math.random().toString(36).slice(2),
  day: "2026-08-06",
  clientName: "Acme",
  task: "Bookkeeping",
  minutes: 60,
  startMinute: 9 * 60,
  running: false,
  ...over,
});

describe("calendar arithmetic — strings in, strings out", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("crosses a leap day correctly", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("starts the week on MONDAY", () => {
    // 2026-08-06 is a Thursday.
    expect(startOfWeek("2026-08-06")).toBe("2026-08-03");
    // A Sunday belongs to the week that began the previous Monday, not the
    // next one — the mistake that shifts a whole board by a day.
    expect(startOfWeek("2026-08-09")).toBe("2026-08-03");
    expect(startOfWeek("2026-08-03")).toBe("2026-08-03");
  });

  it("gives seven days, Monday to Sunday", () => {
    const w = weekDays("2026-08-06");
    expect(w).toHaveLength(7);
    expect(w[0]).toBe("2026-08-03");
    expect(w[6]).toBe("2026-08-09");
  });
});

describe("monthCells", () => {
  it("is ALWAYS 42 cells, so the grid never changes height", () => {
    // A five-row month growing to six makes the page jump a row as you page
    // through the year.
    for (const d of ["2026-02-01", "2026-08-15", "2028-02-10", "2026-11-30"]) {
      expect(monthCells(d)).toHaveLength(42);
    }
  });

  it("starts on the Monday on or before the 1st", () => {
    // 2026-08-01 is a Saturday, so the grid opens on Mon 27 July.
    expect(monthCells("2026-08-06")[0]).toBe("2026-07-27");
  });

  it("contains every day of the month it is for", () => {
    const cells = new Set(monthCells("2026-02-10"));
    for (let d = 1; d <= 28; d++) {
      expect(cells.has(`2026-02-${String(d).padStart(2, "0")}`)).toBe(true);
    }
  });
});

describe("shiftAnchor", () => {
  it("pages by the active view's own unit", () => {
    expect(shiftAnchor("day", "2026-08-06", 1)).toBe("2026-08-07");
    expect(shiftAnchor("week", "2026-08-06", 1)).toBe("2026-08-13");
    expect(shiftAnchor("week", "2026-08-06", -1)).toBe("2026-07-30");
  });

  it("⚠️ does not skip a short month when paging from a long one", () => {
    // Naively adding a month to Jan 31 lands on Mar 3. February must not be
    // skippable by paging.
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-03-31", -1)).toBe("2026-02-01");
  });

  it("crosses a year", () => {
    expect(shiftAnchor("month", "2026-12-15", 1)).toBe("2027-01-01");
  });
});

describe("daysForView", () => {
  it("covers exactly what each view draws", () => {
    expect(daysForView("day", "2026-08-06")).toEqual(["2026-08-06"]);
    expect(daysForView("week", "2026-08-06")).toHaveLength(7);
    expect(daysForView("month", "2026-08-06")).toHaveLength(42);
  });
});

describe("groupByDay", () => {
  it("puts the RUNNING timer first in its day", () => {
    // It is the thing happening now; burying it under this morning's finished
    // work would make you hunt for the Stop button.
    const grouped = groupByDay([
      card({ id: "morning", startMinute: 9 * 60 }),
      card({ id: "live", running: true, startMinute: 14 * 60 }),
      card({ id: "noon", startMinute: 12 * 60 }),
    ]);
    expect(grouped.get("2026-08-06")!.map((c) => c.id)).toEqual([
      "live",
      "morning",
      "noon",
    ]);
  });

  it("orders finished entries by when they started", () => {
    const grouped = groupByDay([
      card({ id: "b", startMinute: 15 * 60 }),
      card({ id: "a", startMinute: 8 * 60 }),
    ]);
    expect(grouped.get("2026-08-06")!.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("omits days with nothing on them", () => {
    expect(groupByDay([]).size).toBe(0);
  });
});

describe("totalMinutes", () => {
  it("adds up the days asked for and ignores the rest", () => {
    const cards = [
      card({ day: "2026-08-06", minutes: 60 }),
      card({ day: "2026-08-07", minutes: 30 }),
      card({ day: "2026-09-01", minutes: 999 }),
    ];
    const week = new Set(["2026-08-06", "2026-08-07"]);
    expect(totalMinutes(cards, week)).toBe(90);
  });

  it("⚠️ includes the seconds the running timer has added", () => {
    // The handoff: totals include the running timer and tick with it. A week
    // total that ignored the clock currently running would be wrong by exactly
    // the thing you are watching.
    const cards = [card({ minutes: 30, running: true })];
    expect(totalMinutes(cards, undefined, 120)).toBe(32);
  });

  it("does not add running seconds when the timer is outside the range", () => {
    const cards = [card({ day: "2026-08-06", minutes: 30, running: true })];
    const otherWeek = new Set(["2026-09-01"]);
    expect(totalMinutes(cards, otherWeek, 600)).toBe(0);
  });
});

describe("formatDayTotal", () => {
  it("blanks a day with nothing on it rather than writing 0m", () => {
    // A day you did not work is blank; it is not a day you worked none.
    expect(formatDayTotal(0)).toBe("—");
    expect(formatDayTotal(220)).toBe("3h 40m");
  });
});
