import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import { computeOverviewStats } from "@/lib/dashboard/overview-stats";

// Overview stats strip — four quiet at-a-glance counts in a thin full-width
// strip across the top of the Overview, directly above Needs attention. Four
// equal cells, each a faint hairline rule plus its count and label, kept
// compact so the strip stays slim and Needs attention sits high. Mesh, not
// box: no card chrome, just a whisper hairline per stat and spacing — much
// quieter than Needs attention. On phones the four wrap to a 2×2. Each stat
// is a link; counts come from computeOverviewStats over the same WorklistRow[]
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
      <ul className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 sm:gap-x-8 sm:gap-y-0">
        {items.map((s) => (
          <li key={s.key} className="min-w-0">
            <Link
              href={s.href}
              className="group flex min-w-0 flex-col gap-1 rounded-r-sm border-l border-border/40 pl-3 transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pl-4"
            >
              <span className="block text-2xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
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
