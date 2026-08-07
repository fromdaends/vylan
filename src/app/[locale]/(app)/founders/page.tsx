// THE FOUNDERS CONSOLE — Vylan's own view of Vylan.
//
// Every other page in this app answers "how is MY firm doing". This one answers
// "how are our CUSTOMERS doing" — every firm on the platform, what they are
// actually using, every event they generate, and the demo-form pipeline feeding
// them. It is the only cross-tenant surface in the product.
//
// ── THREE THINGS TO KNOW BEFORE EDITING ──────────────────────────────────────
//
// 1. THE GATE IS getFounderUser() AND IT RUNS FIRST. Everything below it reads
//    with the service role, so no loader may be called before that check has
//    passed. notFound() rather than a 403: a page that admits it exists and
//    refuses is an invitation.
//
// 2. IT IS ALSO THE SIGNED-OUT GUARD. The app layout redirects an
//    unauthenticated request to /login, but a Next layout and its page render
//    CONCURRENTLY — the redirect does not preempt this component. getCurrentUser
//    returns null for an anonymous request, so the check below short-circuits
//    before any read fires. Do not move a loader above it.
//
// 3. NOTHING HERE WRITES. No server actions, no mutations, no admin controls.
//    The console reads. If a "suspend this firm" button ever lands here it needs
//    its own audit trail and its own confirmation, and it should probably not
//    live behind an env var.

export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { founderEmails, getFounderUser } from "@/lib/founders/access";
import { loadFoundersData } from "@/lib/founders/load";
import { formatCents, formatMinutes, relativeAge } from "@/lib/founders/aggregate";
import { KpiCard } from "@/components/dashboard/dashboard-cards";
import { ViewTabs } from "@/components/ui/view-tabs";
import { Panel, ProportionBar, StatGrid } from "@/components/founders/stat-grid";
import { ActivityChart, SignupsChart } from "@/components/founders/charts";
import { ActivityFeed } from "@/components/founders/activity-feed";
import { FirmsTable } from "@/components/founders/firms-table";
import { LeadsTable } from "@/components/founders/leads-table";
import { HealthView } from "@/components/founders/health-view";

type Tab = "overview" | "firms" | "activity" | "leads" | "health";

function toTab(v: unknown): Tab {
  return v === "firms" || v === "activity" || v === "leads" || v === "health" ? v : "overview";
}

export default async function FoundersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // THE GATE. Nothing below this line may move above it.
  const user = await getFounderUser();
  if (!user) notFound();

  const sp = await searchParams;
  const tab = toTab(sp.tab);
  const t = await getTranslations("Founders");

  // The LOADER reads the clock, not this render: react-hooks/purity forbids
  // Date.now() here (same reason the app layout defers "now" into
  // isTrialExpired), and every relative age on the page has to be measured
  // from one instant anyway or two cards can disagree by a second.
  const data = await loadFoundersData();
  const nowMs = Date.parse(data.generatedAt);
  const { totals } = data;

  const tabs = [
    { key: "overview", label: t("tab_overview"), href: "/founders" },
    { key: "firms", label: t("tab_firms"), href: "/founders?tab=firms", count: totals.firms },
    {
      key: "activity",
      label: t("tab_activity"),
      href: "/founders?tab=activity",
      count: data.feed.length,
    },
    { key: "leads", label: t("tab_leads"), href: "/founders?tab=leads", count: totals.leads },
    {
      key: "health",
      label: t("tab_health"),
      href: "/founders?tab=health",
      count: data.health.jobsFailed || undefined,
      tone: data.health.jobsFailed > 0 ? ("destructive" as const) : ("default" as const),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] animate-in-fade">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("page_title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("page_subtitle", { window: data.windowDays })}
        </p>
      </header>

      <ViewTabs tabs={tabs} activeKey={tab} ariaLabel={t("page_title")} className="mb-6" />

      {tab === "overview" && (
        <div className="space-y-6">
          {/* The four numbers worth a 40px numeral. Everything else is the
              quieter grid underneath — a page of nineteen giant figures has no
              headline at all. */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title={t("kpi_firms")}
              description={t("kpi_firms_hint", { demo: totals.demoFirms })}
              value={String(totals.realFirms)}
              exploreHref="/founders?tab=firms"
              exploreLabel={t("explore")}
              menuLabel={t("card_menu")}
            />
            <KpiCard
              title={t("kpi_active")}
              description={t("kpi_active_hint")}
              value={String(totals.activeFirms7d)}
              exploreHref="/founders?tab=firms"
              exploreLabel={t("explore")}
              menuLabel={t("card_menu")}
            />
            <KpiCard
              title={t("kpi_events")}
              description={t("kpi_events_hint", { window: data.windowDays })}
              value={totals.events30d.toLocaleString(locale)}
              exploreHref="/founders?tab=activity"
              exploreLabel={t("explore")}
              menuLabel={t("card_menu")}
            />
            <KpiCard
              title={t("kpi_collected")}
              description={t("kpi_collected_hint")}
              value={formatCents(totals.paidCents)}
              exploreLabel={t("explore")}
              menuLabel={t("card_menu")}
            />
          </div>

          <Panel title={t("panel_numbers")}>
            <StatGrid
              columns={5}
              stats={[
                { key: "users", label: t("stat_users"), value: String(totals.users) },
                { key: "clients", label: t("stat_clients"), value: String(totals.clients) },
                {
                  key: "engagements",
                  label: t("stat_engagements"),
                  value: String(totals.engagements),
                },
                { key: "docs", label: t("stat_documents"), value: String(totals.documents) },
                {
                  key: "invoiced",
                  label: t("stat_invoiced"),
                  value: formatCents(totals.invoicedCents),
                },
                { key: "messages", label: t("stat_messages"), value: String(totals.messages) },
                {
                  key: "time",
                  label: t("stat_time"),
                  value: formatMinutes(totals.timeMinutes),
                },
                {
                  key: "new",
                  label: t("stat_new_firms"),
                  value: String(totals.newFirms30d),
                  hint: t("stat_new_firms_hint", { window: data.windowDays }),
                },
                {
                  key: "active30",
                  label: t("stat_active_30"),
                  value: String(totals.activeFirms30d),
                  hint: t("stat_active_30_hint", { total: totals.firms }),
                },
                {
                  key: "leads",
                  label: t("stat_leads"),
                  value: String(totals.leads),
                  hint: t("stat_leads_hint", { booked: totals.leadsBooked }),
                },
              ]}
            />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <SignupsChart data={data.signups} locale={locale} />
            <ActivityChart data={data.activityByDay} locale={locale} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("panel_adoption")}>
              <p className="mb-4 -mt-2 text-xs text-muted-foreground">
                {t("panel_adoption_hint")}
              </p>
              <div className="space-y-3">
                {data.adoption.map((a) => (
                  <ProportionBar
                    key={a.key}
                    value={a.firms}
                    outOf={a.outOf}
                    label={t(`adoption_${a.key}`)}
                  />
                ))}
              </div>
            </Panel>

            <Panel
              title={t("panel_most_active")}
              action={
                <Link
                  href="/founders?tab=firms"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  {t("see_all")}
                </Link>
              }
            >
              {data.firms.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("firms_empty")}</p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {[...data.firms]
                    .sort((a, b) => b.events30d - a.events30d || a.name.localeCompare(b.name))
                    .slice(0, 8)
                    .map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <Link
                            href={`/founders/firms/${f.id}`}
                            className="truncate text-sm font-medium hover:underline"
                          >
                            {f.name}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {t("most_active_line", {
                              clients: f.activeClients,
                              engagements: f.engagements,
                              age: relativeAge(f.lastActivityAt, nowMs),
                            })}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm tabular-nums">{f.events30d}</span>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel
            title={t("panel_latest")}
            action={
              <Link
                href="/founders?tab=activity"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {t("see_all")}
              </Link>
            }
          >
            <ActivityFeed events={data.feed.slice(0, 15)} locale={locale} compact />
          </Panel>
        </div>
      )}

      {tab === "firms" && (
        <Panel title={t("panel_firms")}>
          <FirmsTable rows={data.firms} nowMs={nowMs} />
        </Panel>
      )}

      {tab === "activity" && (
        <Panel title={t("panel_activity")}>
          <p className="mb-4 -mt-2 text-xs text-muted-foreground">
            {t("panel_activity_hint", { count: data.feed.length })}
          </p>
          <ActivityFeed events={data.feed} locale={locale} />
        </Panel>
      )}

      {tab === "leads" && (
        <Panel title={t("panel_leads")}>
          <LeadsTable leads={data.leads} nowMs={nowMs} />
        </Panel>
      )}

      {tab === "health" && (
        <HealthView
          health={data.health}
          capped={data.capped}
          allowlist={founderEmails()}
          nowMs={nowMs}
          labels={{
            jobs: t("health_jobs"),
            jobsPending: t("health_jobs_pending"),
            jobsRunning: t("health_jobs_running"),
            jobsFailed: t("health_jobs_failed"),
            jobsDone: t("health_jobs_done"),
            jobsHealthy: t("health_jobs_healthy"),
            failures: t("health_failures"),
            attempts: t("health_attempts"),
            ai: t("health_ai"),
            aiUsed: t("health_ai_used"),
            aiUsedHint: t("health_ai_used_hint"),
            aiOverHalf: t("health_ai_over_half"),
            aiOverHalfHint: t("health_ai_over_half_hint"),
            truncation: t("health_truncation"),
            truncationWarning: t("health_truncation_warning"),
            truncationNone: t("health_truncation_none"),
            access: t("health_access"),
            accessHint: t("health_access_hint"),
          }}
        />
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground/70">
        {t("generated_at", { at: new Date(data.generatedAt).toLocaleString(locale) })}
      </p>
    </div>
  );
}
