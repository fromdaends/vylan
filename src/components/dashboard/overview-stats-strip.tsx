import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import { computeOverviewStats } from "@/lib/dashboard/overview-stats";

// Overview stats strip — a slim, quiet row of four at-a-glance counts
// anchoring the Overview's top-left, beside Needs attention.
// Deliberately MUCH quieter than Needs attention (mesh, not box:
// no card chrome, just a whisper hairline per stat and spacing). Each stat is
// a link; counts come from computeOverviewStats over the same WorklistRow[]
// the page already loaded, so they always agree with the views they link to.
//
// "Waiting on clients" and "Due soon" have no dedicated filtered view today,
// so they land on the Active list (the closest superset) per the brief.
export async function OverviewStatsStrip({ rows }: { rows: WorklistRow[] }) {
  const t = await getTranslations("Dashboard");
  const stats = computeOverviewStats(rows);

  const items = [
    { key: "active", count: stats.active, label: t("stats_active"), href: "/engagements" },
    { key: "ready", count: stats.readyToReview, label: t("stats_ready"), href: "/engagements/ready" },
    { key: "waiting", count: stats.waitingOnClients, label: t("stats_waiting_clients"), href: "/engagements" },
    { key: "due", count: stats.dueSoon, label: t("stats_due_soon"), href: "/engagements" },
  ] as const;

  return (
    <section aria-label={t("stats_label")}>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 2xl:grid-cols-2">
        {items.map((s) => (
          <li key={s.key} className="min-w-0">
            <Link
              href={s.href}
              className="group block min-w-0 border-l border-border/40 pl-3 transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-sm"
            >
              <span className="block text-xl font-semibold leading-tight tracking-tight tabular-nums text-foreground">
                {s.count}
              </span>
              <span className="block truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground/80">
                {s.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
