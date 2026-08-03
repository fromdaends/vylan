// Two filters, and deliberately only two.
//
// "Mine" and "Open" are the questions somebody actually opens this screen with.
// Canopy's equivalent carries a priority column that reads "No priority" on all
// 490 of its rows in their own demo — a control everybody ignores still costs a
// column forever, so it is not here.
//
// They are LINKS, not state: the filtered list is worth being a URL you can
// send to somebody, and the back button should undo a filter.

import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";

export type WorkScope = "all" | "mine";

export async function WorkFilters({
  scope,
  openOnly,
  counts,
}: {
  scope: WorkScope;
  openOnly: boolean;
  counts: { all: number; mine: number };
}) {
  const t = await getTranslations("Engagements");
  const href = (next: { scope?: WorkScope; open?: boolean }) => {
    const s = next.scope ?? scope;
    const o = next.open ?? openOnly;
    const q = new URLSearchParams();
    if (s === "mine") q.set("scope", "mine");
    if (!o) q.set("open", "0");
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
      <Link href={href({ open: !openOnly })} className={chip(!openOnly)}>
        {t("work_filter_done")}
      </Link>
    </div>
  );
}
