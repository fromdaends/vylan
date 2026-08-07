// ONE FIRM, everything we know about them.
//
// Reached by clicking any firm name in the console. Same gate as /founders —
// repeated here rather than inherited, because a route that depends on its
// parent having checked is one refactor away from being open.
//
// The numbers on this page come from the SAME loadFoundersData() the table uses
// and are then narrowed to one firm, so the two can never disagree. That costs
// one extra second on a page nobody opens in a loop, and it buys the guarantee
// that a founder who clicks "12 engagements" is not shown 11.

export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { getFounderUser } from "@/lib/founders/access";
import { loadFirmDetail } from "@/lib/founders/load";
import { formatCents, formatMinutes, relativeAge } from "@/lib/founders/aggregate";
import { humaniseAction } from "@/lib/founders/actions";
import { Panel, StatGrid } from "@/components/founders/stat-grid";
import { ActivityChart } from "@/components/founders/charts";
import { ActivityFeed } from "@/components/founders/activity-feed";

export default async function FounderFirmPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // THE GATE, again. Not inherited.
  const user = await getFounderUser();
  if (!user) notFound();

  // The loader reads the clock (see the sibling page): Date.now() in a render
  // is an impure call, and every age below must share one instant.
  const detail = await loadFirmDetail(id);
  if (!detail) notFound();
  const nowMs = Date.parse(detail.generatedAt);

  const t = await getTranslations("Founders");
  const { firm } = detail;

  const integrations = (Object.entries(firm.integrations) as Array<[string, boolean]>).filter(
    ([, on]) => on,
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] animate-in-fade">
      <Link
        href="/founders?tab=firms"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("back_to_firms")}
      </Link>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{firm.name}</h1>
          <span className="rounded border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {firm.plan}
          </span>
          {firm.isDemo && (
            <span className="rounded bg-secondary px-2 py-0.5 text-[11px] uppercase tracking-wide text-secondary-foreground">
              {t("tag_demo")}
            </span>
          )}
          {firm.isPilot && (
            <span className="rounded bg-secondary px-2 py-0.5 text-[11px] uppercase tracking-wide text-secondary-foreground">
              {t("tag_pilot")}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("firm_meta", {
            joined: relativeAge(firm.createdAt, nowMs),
            locale: firm.locale.toUpperCase(),
            province: firm.province ?? "—",
          })}
          {!firm.onboardedAt && ` · ${t("tag_not_onboarded")}`}
        </p>
        {/* The id, because the next thing a founder does with a firm is query
            it in the SQL editor. */}
        <p className="mt-1 select-all font-mono text-[11px] text-muted-foreground/70">{firm.id}</p>
      </header>

      <div className="space-y-6">
        <Panel title={t("panel_numbers")}>
          <StatGrid
            columns={5}
            stats={[
              {
                key: "people",
                label: t("stat_users"),
                value: String(firm.activeUsers),
                hint: t("stat_users_hint", { owners: firm.owners, total: firm.users }),
              },
              {
                key: "clients",
                label: t("stat_clients"),
                value: String(firm.activeClients),
                hint: t("stat_clients_hint", { total: firm.clients }),
              },
              {
                key: "engagements",
                label: t("stat_engagements"),
                value: String(firm.engagements),
                hint: t("stat_engagements_hint", {
                  active: firm.activeEngagements,
                  drafts: firm.draftEngagements,
                }),
              },
              {
                key: "tasks",
                label: t("stat_tasks"),
                value: String(firm.tasks),
                hint: t("stat_tasks_hint", { open: firm.openTasks }),
              },
              { key: "docs", label: t("stat_documents"), value: String(firm.documents) },
              {
                key: "invoiced",
                label: t("stat_invoiced"),
                value: formatCents(firm.invoicedCents),
                hint: t("stat_invoiced_hint", { count: firm.invoices }),
              },
              {
                key: "collected",
                label: t("stat_collected"),
                value: formatCents(firm.paidCents),
              },
              { key: "messages", label: t("stat_messages"), value: String(firm.messages) },
              { key: "time", label: t("stat_time"), value: formatMinutes(firm.timeMinutes) },
              {
                key: "clientevents",
                label: t("stat_client_events"),
                value: String(firm.clientEvents30d),
                hint: t("stat_client_events_hint"),
                muted: firm.clientEvents30d === 0,
              },
              {
                key: "assistant",
                label: t("stat_assistant"),
                value: String(firm.assistantMessages),
                muted: firm.assistantMessages === 0,
              },
              {
                key: "signatures",
                label: t("stat_signatures"),
                value: String(firm.signatures),
                muted: firm.signatures === 0,
              },
              {
                key: "ai",
                label: t("stat_ai"),
                value: String(firm.aiUsedThisMonth),
                hint: t("stat_ai_hint"),
                muted: firm.aiUsedThisMonth === 0,
              },
            ]}
          />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <ActivityChart
            data={detail.activityByDay}
            locale={locale}
            title={t("chart_firm_activity")}
          />

          <Panel title={t("panel_setup")}>
            <ul className="space-y-2 text-sm">
              <SetupRow label={t("setup_workflows")} on={firm.workflowsEnabled} />
              <SetupRow label={t("setup_time")} on={firm.timeInsightsEnabled} />
              <SetupRow label={t("setup_services")} on={firm.services > 0} count={firm.services} />
              <SetupRow
                label={t("setup_templates")}
                on={firm.templates > 0}
                count={firm.templates}
              />
              <SetupRow
                label={t("setup_automations")}
                on={firm.automations > 0}
                count={firm.automations}
              />
            </ul>
            <h4 className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("setup_integrations")}
            </h4>
            {integrations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("setup_no_integrations")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {integrations.map(([key]) => (
                  <span
                    key={key}
                    className="rounded-full border border-border px-2 py-0.5 text-xs capitalize"
                  >
                    {key}
                  </span>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={t("panel_people")}>
            {detail.people.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("people_empty")}</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {detail.people.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {p.name}
                        {p.deactivatedAt && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {t("tag_deactivated")}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.email} · {p.role}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm tabular-nums">{p.events30d}</p>
                      <p className="text-xs text-muted-foreground">
                        {relativeAge(p.lastEventAt, nowMs)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t("panel_top_actions")}>
            {detail.topActions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("feed_empty")}</p>
            ) : (
              <ul className="space-y-1.5">
                {detail.topActions.map((a) => (
                  <li key={a.action} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{humaniseAction(a.action)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{a.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title={t("panel_recent_engagements")}>
          {detail.recentEngagements.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("engagements_empty")}
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {detail.recentEngagements.slice(0, 15).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.clientName ?? t("unknown_client")} · {relativeAge(e.createdAt, nowMs)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {e.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("panel_firm_activity")}>
          <ActivityFeed events={detail.feed} locale={locale} showFirm={false} />
        </Panel>
      </div>
    </div>
  );
}

function SetupRow({ label, on, count }: { label: string; on: boolean; count?: number }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className={on ? "" : "text-muted-foreground"}>{label}</span>
      <span
        className={
          on ? "text-sm tabular-nums text-emerald-600 dark:text-emerald-400" : "text-sm text-muted-foreground"
        }
      >
        {count != null ? count : on ? "✓" : "—"}
      </span>
    </li>
  );
}
