import { describe, it, expect } from "vitest";
import {
  addDays,
  bucketForDueDate,
  dateInTimeZone,
  daysBetween,
  endOfWeek,
  formatDueShort,
  formatDueWeekday,
  groupTasks,
  matchesDueFilter,
  taskStats,
  toDueFilter,
  todayInTimeZone,
} from "./dates";

// The approved mock's own day: Monday, August 3rd 2026.
const MONDAY = "2026-08-03";

const task = (
  status: "todo" | "doing" | "done",
  dueDate: string | null,
  completedAt: string | null = null,
) => ({ status, dueDate, completedAt });

describe("todayInTimeZone", () => {
  it("gives the firm's date, not UTC's", () => {
    // 01:30 UTC on Aug 4 is still the evening of Aug 3 in Quebec — the exact
    // bug the greeting had to dodge and the reason "today" is computed in the
    // firm's timezone everywhere tasks are bucketed.
    const lateEvening = new Date("2026-08-04T01:30:00Z");
    expect(todayInTimeZone("America/Toronto", lateEvening)).toBe("2026-08-03");
    expect(todayInTimeZone("UTC", lateEvening)).toBe("2026-08-04");
  });
});

describe("dateInTimeZone", () => {
  it("converts a completed_at timestamp to the firm's calendar day", () => {
    expect(dateInTimeZone("2026-08-04T01:30:00Z", "America/Toronto")).toBe(
      "2026-08-03",
    );
  });
  it("returns null for garbage", () => {
    expect(dateInTimeZone("not-a-date", "America/Toronto")).toBeNull();
  });
});

describe("week math", () => {
  it("ends a Monday's week on the following Sunday", () => {
    expect(endOfWeek(MONDAY)).toBe("2026-08-09");
  });
  it("ends a Sunday's week on that same Sunday", () => {
    expect(endOfWeek("2026-08-09")).toBe("2026-08-09");
  });
  it("adds days across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });
  it("counts days between dates", () => {
    expect(daysBetween("2026-07-30", MONDAY)).toBe(4);
    expect(daysBetween(MONDAY, MONDAY)).toBe(0);
  });
  it("is not thrown off by a DST transition inside the week", () => {
    // Eastern time falls back Nov 1 2026; the week around it must still be
    // seven calendar days.
    expect(addDays("2026-10-31", 7)).toBe("2026-11-07");
    expect(endOfWeek("2026-11-02")).toBe("2026-11-08");
  });
});

describe("bucketForDueDate", () => {
  it("reproduces the approved mock exactly", () => {
    expect(bucketForDueDate("2026-07-30", MONDAY)).toBe("overdue");
    expect(bucketForDueDate(MONDAY, MONDAY)).toBe("today");
    expect(bucketForDueDate("2026-08-05", MONDAY)).toBe("week");
    expect(bucketForDueDate("2026-08-06", MONDAY)).toBe("week");
    // Sunday still belongs to this week; next Tuesday does not.
    expect(bucketForDueDate("2026-08-09", MONDAY)).toBe("week");
    expect(bucketForDueDate("2026-08-11", MONDAY)).toBe("later");
  });
  it("sends no-date and malformed dates to later", () => {
    expect(bucketForDueDate(null, MONDAY)).toBe("later");
    expect(bucketForDueDate("soon", MONDAY)).toBe("later");
  });
});

describe("taskStats", () => {
  // The mock's own numbers: 1 overdue, 1 today, 3 due this week, 6 open.
  const mockTasks = [
    task("doing", "2026-07-30"), // overdue
    task("todo", MONDAY), // today
    task("todo", "2026-08-05"), // wed
    task("todo", "2026-08-06"), // thu
    task("todo", "2026-08-11"), // later
    task("todo", null), // no date
    task("done", MONDAY, "2026-08-03T19:00:00Z"), // done — counts nowhere
  ];
  it("matches the approved mock's strip", () => {
    const s = taskStats(mockTasks, MONDAY);
    expect(s.overdue).toBe(1);
    expect(s.dueToday).toBe(1);
    expect(s.dueThisWeek).toBe(3); // includes today
    expect(s.open).toBe(6);
  });
});

describe("groupTasks", () => {
  it("groups per the mock, sorts open groups soonest-first", () => {
    const g = groupTasks(
      [
        task("todo", "2026-08-06"),
        task("todo", "2026-08-05"),
        task("doing", "2026-07-30"),
        task("todo", null),
        task("todo", "2026-08-11"),
        task("todo", MONDAY),
      ],
      MONDAY,
      "America/Toronto",
    );
    expect(g.overdue.map((t) => t.dueDate)).toEqual(["2026-07-30"]);
    expect(g.today.map((t) => t.dueDate)).toEqual([MONDAY]);
    expect(g.week.map((t) => t.dueDate)).toEqual(["2026-08-05", "2026-08-06"]);
    // Dated-later first, undated at the end.
    expect(g.later.map((t) => t.dueDate)).toEqual(["2026-08-11", null]);
  });

  it("puts done-today under Done today and drops older done work", () => {
    const g = groupTasks(
      [
        // 01:00 UTC Aug 4 = the evening of Aug 3 in Quebec: done TODAY.
        task("done", null, "2026-08-04T01:00:00Z"),
        // Done yesterday — history, not dashboard material.
        task("done", null, "2026-08-02T15:00:00Z"),
        // Done with no timestamp (pre-1340 data) — cannot claim today.
        task("done", null, null),
      ],
      MONDAY,
      "America/Toronto",
    );
    expect(g.doneToday).toHaveLength(1);
    expect(g.overdue).toHaveLength(0);
    expect(g.later).toHaveLength(0);
  });
});

describe("matchesDueFilter", () => {
  it("mirrors the strip cells", () => {
    expect(matchesDueFilter(task("todo", "2026-07-30"), "overdue", MONDAY)).toBe(true);
    expect(matchesDueFilter(task("todo", MONDAY), "today", MONDAY)).toBe(true);
    // The week cell counts today too, so the week filter must include it —
    // a strip cell saying 3 must land on a list showing 3.
    expect(matchesDueFilter(task("todo", MONDAY), "week", MONDAY)).toBe(true);
    expect(matchesDueFilter(task("todo", "2026-08-05"), "week", MONDAY)).toBe(true);
    expect(matchesDueFilter(task("todo", "2026-08-11"), "week", MONDAY)).toBe(false);
    expect(matchesDueFilter(task("todo", null), "week", MONDAY)).toBe(false);
  });
  it("never matches done tasks", () => {
    expect(
      matchesDueFilter(task("done", "2026-07-30", "2026-08-03T12:00:00Z"), "overdue", MONDAY),
    ).toBe(false);
  });
  it("parses only the three known filters", () => {
    expect(toDueFilter("overdue")).toBe("overdue");
    expect(toDueFilter("today")).toBe("today");
    expect(toDueFilter("week")).toBe("week");
    expect(toDueFilter("done")).toBeNull();
    expect(toDueFilter(undefined)).toBeNull();
  });
});

describe("due labels", () => {
  it("formats the mock's strings in English", () => {
    expect(formatDueWeekday("2026-08-05", "en")).toBe("Wed, Aug 5");
    expect(formatDueShort("2026-07-30", "en")).toBe("Jul 30");
  });
  it("formats French without importing English patterns", () => {
    // Exact strings depend on the ICU data, but the weekday must be French.
    expect(formatDueWeekday("2026-08-05", "fr").toLowerCase()).toContain("mer");
    expect(formatDueShort("2026-07-30", "fr").toLowerCase()).toContain("juil");
  });
});
