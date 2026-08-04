// "Mine", "Open", and the three DUE cuts the dashboard's stats strip links to
// (overdue / due today / due this week — decided by lib/tasks/dates, the same
// functions that counted them, so a strip cell saying 3 lands on a list of 3).
//
// Still no priority column: Canopy's equivalent reads "No priority" on all 490
// of its rows in their own demo — a control everybody ignores still costs a
// column forever.
//
// They are LINKS, not state: the filtered list is worth being a URL you can
// send to somebody, and the back button should undo a filter.

import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import type { DueFilter } from "@/lib/tasks/dates";

export type WorkScope = "all" | "mine";

export async function WorkFilters({
  scope,
  openOnly,
  due,
  counts,
}: {
  scope: WorkScope;
  openOnly: boolean;
  due: DueFilter | null;
  counts: { all: number; mine: number; overdue: number; today: number; week: number };
}) {
  const t = await getTranslations("Engagements");
  const href = (next: {
    scope?: WorkScope;
    open?: boolean;
    due?: DueFilter | null;
  }) => {
    const s = next.scope ?? scope;
    const o = next.open ?? openOnly;
    const d = next.due === undefined ? due : next.due;
    const q = new URLSearchParams();
    if (s === "mine") q.set("scope", "mine");
    if (!o) q.set("open", "0");
    if (d) q.set("due", d);
    const qs = q.toString();
    return qs ? `/work?${qs}` : "/work";
  };

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active
        ? "border-foreground bg-foreground text-background"
        : "border-border text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={href({ scope: "all" })} className={chip(scope === "all")}>
        {t("work_filter_all")}{" "}
        <span className="tabular-nums opacity-70">{counts.all}</span>
      </Link>
      <Link href={href({ scope: "mine" })} className={chip(scope === "mine")}>
        {t("work_filter_mine")}{" "}
        <span className="tabular-nums opacity-70">{counts.mine}</span>
      </Link>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      {/* The due cuts. Clicking the active one clears it — a filter you
          cannot un-click is a trap, and the stats strip needs each of these
          to be a stable URL. */}
      <Link
        href={href({ due: due === "overdue" ? null : "overdue" })}
        className={chip(due === "overdue")}
      >
        {t("work_filter_overdue")}{" "}
        <span className="tabular-nums opacity-70">{counts.overdue}</span>
      </Link>
      <Link
        href={href({ due: due === "today" ? null : "today" })}
        className={chip(due === "today")}
      >
        {t("work_filter_due_today")}{" "}
        <span className="tabular-nums opacity-70">{counts.today}</span>
      </Link>
      <Link
        href={href({ due: due === "week" ? null : "week" })}
        className={chip(due === "week")}
      >
        {t("work_filter_due_week")}{" "}
        <span className="tabular-nums opacity-70">{counts.week}</span>
      </Link>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <Link href={href({ open: !openOnly })} className={chip(!openOnly)}>
        {t("work_filter_done")}
      </Link>
    </div>
  );
}
