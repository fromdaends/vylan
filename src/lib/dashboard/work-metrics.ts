// The numbers behind the Work dashboard — PURE, so they can be argued with.
//
// Founder, after reading Canopy's dashboards article and watching their demo:
// "start with the dashboard for tasks + engagements combined that looks and
// replicates Canopys exactly. Literally copy it exactly."
//
// Canopy's Task Dashboard carries four KPIs (Open Tasks, Overdue Tasks,
// Completed Tasks, Percentage complete) and four charts (completed monthly by
// type, completed monthly year over year, created monthly by type, open count
// by status). Those are reproduced here against Vylan's own data.
//
// ── WHY THIS IS A SEPARATE MODULE FROM THE COMPONENTS ─────────────────────
//
// Canopy's dashboards are ThoughtSpot's, embedded in a frame — their article
// says so outright ("We have integrated with ThoughtSpot, an analytics
// platform... seamlessly embeds them directly into Canopy"). Ours are ours,
// which means when a number looks wrong there is no vendor to ask. Every
// figure on that page comes out of a function in this file with a test beside
// it, so "is that 14% right?" is a question with an answer.
//
// ── EVERY DATE DECISION IS THE FIRM'S TIMEZONE, NOT THE SERVER'S ──────────
//
// The server renders in UTC, where a Quebec evening is already tomorrow. The
// existing task strip already learned this (lib/tasks/dates.ts takes a
// timezone); these do the same by taking `today` rather than calling Date.

// The bucket union, spelled out rather than imported from lib/db — this module
// is pure and the page that renders it is a client component. Importing the
// type alone would erase at build time, but the import LINE is the thing that
// keeps getting a server module into a browser bundle by accident (see
// lib/views/saved-view.ts for the last time that cost a production build).
export type TaskBucket = "todo" | "doing" | "done";

/** What one task has to offer this module. A subset of FirmTask on purpose —
 *  the dashboard must not be the reason a reader grows a column. */
export type MetricTask = {
  id: string;
  kind: string;
  status: TaskBucket;
  statusId?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
};

export type Kpis = {
  open: number;
  overdue: number;
  completed: number;
  /** 0–100, one decimal. Canopy prints "14.02%". */
  percentComplete: number;
};

/**
 * Canopy's four headline numbers.
 *
 * ⚠️ OVERDUE IS A SUBSET OF OPEN, not a fifth bucket. A task that is late is
 * still open, and Canopy's own screenshot proves they read it the same way —
 * 141 open with 49 overdue, where 49 > the 23 completed. Adding the two would
 * double-count every late task.
 *
 * `today` is an ISO date (YYYY-MM-DD) already resolved in the firm's timezone.
 */
export function taskKpis(tasks: MetricTask[], today: string): Kpis {
  let open = 0;
  let overdue = 0;
  let completed = 0;

  for (const t of tasks) {
    if (t.status === "done") {
      completed++;
      continue;
    }
    open++;
    // Strictly BEFORE today. Due today is not late — it is today's work, and
    // colouring it red is how a dashboard teaches people to ignore red.
    if (t.dueDate && t.dueDate < today) overdue++;
  }

  const total = open + completed;
  return {
    open,
    overdue,
    completed,
    // Of everything that exists, how much is finished. Rounded to two decimals
    // like Canopy's, then kept as a number so the component decides the format.
    percentComplete: total === 0 ? 0 : Math.round((completed / total) * 10000) / 100,
  };
}

/** One bar on a monthly chart: a month, and a count per series key. */
export type MonthlyPoint = {
  /** YYYY-MM — sortable, and the label is derived at render in the locale. */
  month: string;
  /** kind → count. Absent keys render as no segment, not as zero. */
  counts: Record<string, number>;
  total: number;
};

/** YYYY-MM from an ISO timestamp, or null if it is not one. */
function monthOf(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || iso.length < 7) return null;
  const m = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m : null;
}

/**
 * A dense run of months between the first and last with data — INCLUDING the
 * empty ones.
 *
 * Canopy's own chart has a gap at Sep with Aug and Oct populated, and that gap
 * is information: it says "nothing shipped that month". Plotting only the
 * months that HAVE data would slide October left and quietly erase the gap,
 * which is the single most common way a bar chart lies.
 */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  // Guard against a reversed or malformed range rather than looping forever.
  if (!y || !m || !ty || !tm) return out;
  let guard = 0;
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 600) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Tasks grouped by month and split by a key — Canopy's "Tasks Completed
 * Monthly by Task Type" and "Tasks Created Monthly by Task Type".
 *
 * `pick` chooses which date the task is counted on, which is the only
 * difference between the completed chart and the created one.
 */
export function monthlyByKind(
  tasks: MetricTask[],
  pick: (t: MetricTask) => string | null | undefined,
  opts: { months?: number } = {},
): MonthlyPoint[] {
  const byMonth = new Map<string, Record<string, number>>();
  for (const t of tasks) {
    const month = monthOf(pick(t));
    if (!month) continue;
    const row = byMonth.get(month) ?? {};
    row[t.kind] = (row[t.kind] ?? 0) + 1;
    byMonth.set(month, row);
  }
  if (byMonth.size === 0) return [];

  const months = [...byMonth.keys()].sort();
  let span = monthRange(months[0], months[months.length - 1]);
  // A cap, applied to the TAIL — a chart of sixty months is a smear. Canopy's
  // shows about a year.
  if (opts.months && span.length > opts.months) span = span.slice(-opts.months);

  return span.map((month) => {
    const counts = byMonth.get(month) ?? {};
    return {
      month,
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  });
}

/** Every series key present, in a stable order — what the legend draws. */
export function kindsPresent(points: MonthlyPoint[]): string[] {
  const seen = new Set<string>();
  for (const p of points) for (const k of Object.keys(p.counts)) seen.add(k);
  return [...seen].sort();
}

export type YearOverYearPoint = {
  /** 1–12. The label is the month name, rendered in the locale. */
  monthIndex: number;
  /** year → count for that calendar month. */
  byYear: Record<string, number>;
};

/**
 * Canopy's "Tasks Completed Monthly Year Over Year": one line per year, the
 * x-axis being the twelve calendar months, so this March sits directly above
 * last March.
 *
 * All twelve months are always returned even when only four have data —
 * otherwise two years with different active months would be plotted against
 * different axes and the comparison the chart exists for would be false.
 */
export function completedYearOverYear(tasks: MetricTask[]): {
  points: YearOverYearPoint[];
  years: string[];
} {
  const years = new Set<string>();
  const grid = new Map<string, number>(); // `${year}-${monthIndex}` → count

  for (const t of tasks) {
    const month = monthOf(t.completedAt);
    if (!month) continue;
    const [y, m] = month.split("-");
    years.add(y);
    const key = `${y}-${Number(m)}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }

  const sortedYears = [...years].sort();
  const points: YearOverYearPoint[] = [];
  for (let i = 1; i <= 12; i++) {
    const byYear: Record<string, number> = {};
    for (const y of sortedYears) byYear[y] = grid.get(`${y}-${i}`) ?? 0;
    points.push({ monthIndex: i, byYear });
  }
  return { points, years: sortedYears };
}

export type StatusSlice = {
  id: string;
  name: string;
  color: string;
  count: number;
  /** 0–100, one decimal — Canopy prints "Draft - 1 (1.45%)". */
  percent: number;
};

/**
 * Canopy's "Open Task Count by Status" donut.
 *
 * OPEN ONLY, as the title says. Including finished work would make every firm's
 * donut mostly "Done" and answer a question nobody asked — the chart exists to
 * show where live work is stuck.
 *
 * Statuses with nothing in them are dropped: a legend entry for a slice of zero
 * is a line of text pointing at nothing.
 */
export function openByStatus(
  tasks: MetricTask[],
  statuses: { id: string; name: string; color: string; bucket: TaskBucket }[],
): StatusSlice[] {
  const open = tasks.filter((t) => t.status !== "done");
  const counts = new Map<string, number>();
  for (const t of open) {
    // Fall back to the BUCKET when a task carries no firm status — the same
    // resolution the tasks table does, so the donut and the list agree.
    const status =
      statuses.find((s) => s.id === t.statusId) ??
      statuses.find((s) => s.bucket === t.status);
    const key = status?.id ?? `bucket:${t.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = open.length;
  return statuses
    .map((s) => {
      const count = counts.get(s.id) ?? 0;
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        count,
        percent: total === 0 ? 0 : Math.round((count / total) * 10000) / 100,
      };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
}
