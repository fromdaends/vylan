"use client";

// The Insights shell: range selector, three tabs, the missing-rate banner.
// All data arrives computed from the server (lib/insights/load.ts) — this
// component decides only what is on screen. PURE ARITHMETIC over real data;
// no AI commentary anywhere, by explicit product rule.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { ViewTabs } from "@/components/ui/view-tabs";
import { FilterLinks } from "@/components/ui/filter-links";
import { OverviewTab } from "@/components/insights/overview-tab";
import { ClientsTab } from "@/components/insights/clients-tab";
import { TeamTab } from "@/components/insights/team-tab";
import { INSIGHTS_RANGES, type InsightsRange } from "@/lib/insights/metrics";
import type { InsightsPayload } from "@/lib/insights/load";

export type InsightsTab = "overview" | "clients" | "team";

const BANNER_KEY = "insights_rate_banner_dismissed";

export function InsightsView({
  data,
  tab,
  range,
}: {
  data: InsightsPayload;
  tab: InsightsTab;
  range: InsightsRange;
}) {
  const t = useTranslations("Insights");
  // Dismissal is local and quiet (localStorage): the banner is a nudge, not a
  // task, and a server round-trip to remember "I saw this" is ceremony.
  // Starts hidden and reveals after mount so the server render never
  // disagrees with a browser that has dismissed it.
  const [bannerVisible, setBannerVisible] = useState(false);
  useEffect(() => {
    if (data.missingRates.length === 0) return;
    // Deferred a frame (the timer pill's pattern) — the React Compiler rules
    // reject synchronous setState in an effect body, and the reveal is
    // intentionally post-hydration anyway.
    const raf = requestAnimationFrame(() => {
      let dismissed = false;
      try {
        dismissed = window.localStorage.getItem(BANNER_KEY) === "1";
      } catch {
        // Storage unavailable — show the banner.
      }
      if (!dismissed) setBannerVisible(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [data.missingRates.length]);

  const href = (nextTab: InsightsTab, nextRange: InsightsRange) =>
    `/insights?tab=${nextTab}${nextRange === "this_year" ? "" : `&range=${nextRange}`}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <FilterLinks
          label={t("range_label")}
          items={INSIGHTS_RANGES.map((r) => ({
            key: r,
            href: href(tab, r),
            label: t(`range_${r}`),
            active: r === range,
          }))}
        />
      </div>

      {bannerVisible && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="text-muted-foreground">
            {t("missing_rates_banner", { count: data.missingRates.length })}{" "}
            <Link
              href="/settings/team"
              className="font-medium text-accent transition-colors hover:text-accent-hover"
            >
              {t("missing_rates_link")}
            </Link>
          </p>
          <button
            type="button"
            aria-label={t("banner_dismiss")}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
              setBannerVisible(false);
              try {
                window.localStorage.setItem(BANNER_KEY, "1");
              } catch {
                // Storage unavailable — the dismissal just doesn't persist.
              }
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      <ViewTabs
        activeKey={tab}
        ariaLabel={t("tabs_label")}
        tabs={[
          { key: "overview", label: t("tab_overview"), href: href("overview", range) },
          { key: "clients", label: t("tab_clients"), href: href("clients", range) },
          { key: "team", label: t("tab_team"), href: href("team", range) },
        ]}
      />

      {/* Hours-dependent surfaces get an explainer instead of empty axes when
          nothing is tracked yet; revenue-only charts still render if payment
          data exists (the per-chart `empty` props handle the split). */}
      {!data.hasEntries && tab !== "overview" && (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {t("no_entries_explainer")}
        </p>
      )}

      {tab === "overview" ? (
        <OverviewTab data={data} />
      ) : tab === "clients" ? (
        <ClientsTab data={data} />
      ) : (
        <TeamTab data={data} />
      )}
    </div>
  );
}
