import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { TaskStats } from "@/lib/tasks/dates";

// Task stats strip (design 2a) — four hairline cells above the grid, each a
// link landing on /work pre-filtered to exactly the rows it counted. Counts
// come from taskStats() over the same list the Tasks card renders, so the
// number and the list it opens can never disagree.
//
// Same mesh-not-box construction as the engagement strip it replaces: no card
// chrome, a left rule per cell, 2×2 on phones.
export async function TaskStatsStrip({ stats }: { stats: TaskStats }) {
  const t = await getTranslations("Dashboard");

  const cells = [
    {
      key: "overdue",
      count: stats.overdue,
      label: t("task_stats_overdue"),
      href: "/work?due=overdue",
      // The one loud cell: a thicker destructive rule and a red count. Overdue
      // is the only number on this page that is always bad news.
      rule: "border-l-2 border-destructive/50",
      countClass: "text-destructive",
    },
    {
      key: "today",
      count: stats.dueToday,
      label: t("task_stats_due_today"),
      href: "/work?due=today",
      rule: "border-l border-border",
      countClass: "text-foreground",
    },
    {
      key: "week",
      count: stats.dueThisWeek,
      label: t("task_stats_due_week"),
      href: "/work?due=week",
      rule: "border-l border-border",
      countClass: "text-foreground",
    },
    {
      key: "open",
      count: stats.open,
      label: t("task_stats_open"),
      href: "/work",
      rule: "border-l border-border",
      countClass: "text-foreground",
    },
  ] as const;

  return (
    <section aria-label={t("task_stats_label")}>
      <ul className="grid max-w-[880px] grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 sm:gap-8">
        {cells.map((s) => (
          <li key={s.key} className="min-w-0">
            <Link
              href={s.href}
              className={cn(
                "group flex min-w-0 flex-col rounded-r-sm pl-3.5 transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                s.rule,
              )}
            >
              <span
                className={cn(
                  "block text-2xl font-semibold leading-none tracking-tight tabular-nums",
                  s.countClass,
                )}
              >
                {s.count}
              </span>
              <span className="mt-[3px] block truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground/80">
                {s.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
