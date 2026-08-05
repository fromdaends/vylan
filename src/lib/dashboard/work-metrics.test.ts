import { describe, it, expect } from "vitest";
import {
  taskKpis,
  monthRange,
  monthlyByKind,
  kindsPresent,
  completedYearOverYear,
  openByStatus,
  type MetricTask,
} from "./work-metrics";

const task = (t: Partial<MetricTask> & { id: string }): MetricTask => ({
  kind: "task",
  status: "todo",
  ...t,
});

const STATUSES = [
  { id: "s-todo", name: "To do", color: "#64748b", bucket: "todo" as const },
  { id: "s-doing", name: "In progress", color: "#2563eb", bucket: "doing" as const },
  { id: "s-review", name: "Needs review", color: "#a855f7", bucket: "doing" as const },
  { id: "s-done", name: "Done", color: "#16a34a", bucket: "done" as const },
];

describe("taskKpis — Canopy's four headline numbers", () => {
  it("counts open, overdue and completed", () => {
    const kpis = taskKpis(
      [
        task({ id: "1", status: "todo", dueDate: "2026-08-01" }), // late
        task({ id: "2", status: "doing", dueDate: "2026-08-20" }), // not late
        task({ id: "3", status: "done" }),
      ],
      "2026-08-05",
    );
    expect(kpis.open).toBe(2);
    expect(kpis.overdue).toBe(1);
    expect(kpis.completed).toBe(1);
  });

  it("treats overdue as a SUBSET of open, never a fifth bucket", () => {
    // Canopy's own screenshot: 141 open, 49 overdue — 49 of the 141, not 190
    // tasks. Adding them would double-count every late task.
    const kpis = taskKpis(
      [
        task({ id: "1", status: "todo", dueDate: "2026-01-01" }),
        task({ id: "2", status: "todo", dueDate: "2026-01-01" }),
      ],
      "2026-08-05",
    );
    expect(kpis.open).toBe(2);
    expect(kpis.overdue).toBe(2);
  });

  it("does not call today's work late", () => {
    // A due-today task coloured red is how a dashboard teaches people to
    // ignore red.
    const kpis = taskKpis(
      [task({ id: "1", status: "todo", dueDate: "2026-08-05" })],
      "2026-08-05",
    );
    expect(kpis.overdue).toBe(0);
  });

  it("ignores the due date of something already finished", () => {
    const kpis = taskKpis(
      [task({ id: "1", status: "done", dueDate: "2020-01-01" })],
      "2026-08-05",
    );
    expect(kpis.overdue).toBe(0);
    expect(kpis.completed).toBe(1);
  });

  it("gives a percentage to two decimals, like Canopy's 14.02%", () => {
    // 23 of 164 = 14.0243...% → 14.02
    const tasks = [
      ...Array.from({ length: 23 }, (_, i) =>
        task({ id: `d${i}`, status: "done" as const }),
      ),
      ...Array.from({ length: 141 }, (_, i) => task({ id: `o${i}` })),
    ];
    expect(taskKpis(tasks, "2026-08-05").percentComplete).toBe(14.02);
  });

  it("says 0% rather than NaN for a firm with no tasks at all", () => {
    // A brand-new firm opening this page must not be shown "NaN%".
    expect(taskKpis([], "2026-08-05")).toEqual({
      open: 0,
      overdue: 0,
      completed: 0,
      percentComplete: 0,
    });
  });
});

describe("monthRange — the empty months are the point", () => {
  it("fills the gap between two months that have data", () => {
    expect(monthRange("2026-08", "2026-11")).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
  });

  it("rolls over the year boundary", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("returns nothing for a reversed range rather than looping forever", () => {
    expect(monthRange("2026-11", "2026-08")).toEqual([]);
  });
});

describe("monthlyByKind", () => {
  it("splits a month by task type", () => {
    const points = monthlyByKind(
      [
        task({ id: "1", kind: "task", completedAt: "2026-08-03T10:00:00Z" }),
        task({ id: "2", kind: "task", completedAt: "2026-08-09T10:00:00Z" }),
        task({ id: "3", kind: "signature", completedAt: "2026-08-11T10:00:00Z" }),
      ],
      (t) => t.completedAt,
    );
    expect(points).toEqual([
      { month: "2026-08", counts: { task: 2, signature: 1 }, total: 3 },
    ]);
  });

  it("KEEPS a month with nothing in it", () => {
    // Canopy's chart has Aug and Oct populated with Sep empty, and that hole
    // says "nothing shipped in September". Dropping it would slide October
    // left and quietly erase the fact.
    const points = monthlyByKind(
      [
        task({ id: "1", completedAt: "2026-08-03T10:00:00Z" }),
        task({ id: "2", completedAt: "2026-10-03T10:00:00Z" }),
      ],
      (t) => t.completedAt,
    );
    expect(points.map((p) => p.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(points[1].total).toBe(0);
  });

  it("skips tasks with no date on the axis being plotted", () => {
    // An unfinished task has no completedAt and belongs on no bar of the
    // "completed" chart.
    const points = monthlyByKind(
      [task({ id: "1", completedAt: null }), task({ id: "2", completedAt: undefined })],
      (t) => t.completedAt,
    );
    expect(points).toEqual([]);
  });

  it("caps to the most RECENT months, not the oldest", () => {
    const points = monthlyByKind(
      [
        task({ id: "1", completedAt: "2024-01-03T10:00:00Z" }),
        task({ id: "2", completedAt: "2026-08-03T10:00:00Z" }),
      ],
      (t) => t.completedAt,
      { months: 3 },
    );
    expect(points).toHaveLength(3);
    expect(points[points.length - 1].month).toBe("2026-08");
  });

  it("lists every series present for the legend", () => {
    const points = monthlyByKind(
      [
        task({ id: "1", kind: "signature", completedAt: "2026-08-01T00:00:00Z" }),
        task({ id: "2", kind: "task", completedAt: "2026-09-01T00:00:00Z" }),
      ],
      (t) => t.completedAt,
    );
    expect(kindsPresent(points)).toEqual(["signature", "task"]);
  });
});

describe("completedYearOverYear", () => {
  it("puts this March directly above last March", () => {
    const { points, years } = completedYearOverYear([
      task({ id: "1", completedAt: "2025-03-04T00:00:00Z" }),
      task({ id: "2", completedAt: "2026-03-09T00:00:00Z" }),
      task({ id: "3", completedAt: "2026-03-11T00:00:00Z" }),
    ]);
    expect(years).toEqual(["2025", "2026"]);
    const march = points.find((p) => p.monthIndex === 3)!;
    expect(march.byYear).toEqual({ "2025": 1, "2026": 2 });
  });

  it("always returns twelve months, so two years share one axis", () => {
    // Two years with different active months plotted against different axes
    // would make the comparison the chart exists for a false one.
    const { points } = completedYearOverYear([
      task({ id: "1", completedAt: "2026-07-04T00:00:00Z" }),
    ]);
    expect(points).toHaveLength(12);
    expect(points[0].byYear).toEqual({ "2026": 0 });
  });

  it("has no years at all before anything has been finished", () => {
    const { years } = completedYearOverYear([task({ id: "1", status: "todo" })]);
    expect(years).toEqual([]);
  });
});

describe("openByStatus — the donut", () => {
  it("counts only OPEN work", () => {
    // Including finished tasks would make every firm's donut mostly "Done" and
    // answer a question nobody asked.
    const slices = openByStatus(
      [
        task({ id: "1", status: "todo", statusId: "s-todo" }),
        task({ id: "2", status: "done", statusId: "s-done" }),
      ],
      STATUSES,
    );
    expect(slices.map((s) => s.id)).toEqual(["s-todo"]);
  });

  it("falls back to the bucket when a task carries no firm status", () => {
    // Same resolution the tasks table does, so the donut and the list agree.
    const slices = openByStatus(
      [task({ id: "1", status: "doing", statusId: null })],
      STATUSES,
    );
    // "In progress" is the first doing-bucket status, which is what the row
    // would render too.
    expect(slices).toEqual([
      expect.objectContaining({ id: "s-doing", count: 1, percent: 100 }),
    ]);
  });

  it("drops empty statuses instead of legending a slice of nothing", () => {
    const slices = openByStatus(
      [task({ id: "1", status: "todo", statusId: "s-todo" })],
      STATUSES,
    );
    expect(slices.map((s) => s.name)).toEqual(["To do"]);
  });

  it("orders biggest slice first and carries each one's percent", () => {
    const slices = openByStatus(
      [
        task({ id: "1", status: "todo", statusId: "s-todo" }),
        task({ id: "2", status: "doing", statusId: "s-review" }),
        task({ id: "3", status: "doing", statusId: "s-review" }),
        task({ id: "4", status: "doing", statusId: "s-review" }),
      ],
      STATUSES,
    );
    expect(slices.map((s) => [s.name, s.count, s.percent])).toEqual([
      ["Needs review", 3, 75],
      ["To do", 1, 25],
    ]);
  });

  it("returns nothing, not a divide-by-zero, when all work is finished", () => {
    expect(
      openByStatus([task({ id: "1", status: "done", statusId: "s-done" })], STATUSES),
    ).toEqual([]);
  });
});
