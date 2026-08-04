import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { cn } from "@/lib/cn";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { loadAi } from "@/lib/performance/ai";
import { loadAutomation } from "@/lib/performance/automation";
import type { PerformanceRange } from "@/lib/performance/types";
import { AutomatedJobsPanel } from "@/components/vylan/automated-jobs-panel";
import { AiPerformanceTab } from "@/components/vylan/ai-performance-tab";
import {
  AutomationsPanel,
  type AutomationRow,
} from "@/components/vylan/automations-panel";
import {
  listAutomations,
  listAutomationTemplateUseCounts,
} from "@/lib/db/automations";
import { listActiveFirmUsers } from "@/lib/db/users";

// The "Vylan" hub: the firm's own automation surface, reached from the rail's
// Sparkles tab.
//
// THE TAB STRIP IS BACK, and the earlier note about why it went away still
// holds: a strip of ONE is furniture implying a sibling that does not exist.
// There are two real panels again — Automated jobs, and the AI performance
// numbers that came off the retired Performance page — so it is navigation
// once more rather than decoration.
//
// Filing used to be the second tab and now lives at /files?tab=settings, beside
// the documents it files. ?tab=filing still arrives here from bookmarks, older
// emails, and any storage OAuth callback that has not been redeployed, so it
// forwards rather than 404s.
export const dynamic = "force-dynamic";

type VylanTab = "jobs" | "ai";

function parseRange(value: string | undefined): PerformanceRange {
  return value === "this_month" || value === "all_time"
    ? value
    : "last_3_months"; // sensible default: recent, with enough sample to matter
}

export default async function VylanHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; range?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  const sp = await searchParams;
  if (sp.tab === "filing") {
    redirect({ href: "/files?tab=settings", locale });
  }

  setRequestLocale(locale);
  const t = await getTranslations("VylanHub");

  // The automations library lives INSIDE Automated jobs — the founder's call,
  // and the right one: that tab was built as the scaffold for exactly this
  // feature, so the library replaces its "coming soon" promise rather than
  // moving in next door. It rides the Part A switch (1510): a firm that
  // hasn't been turned on sees the hub exactly as before. A stale
  // ?tab=automations link (the brief separate-tab build) lands here too.
  const firm = await getCurrentFirm();
  const workflowsOn =
    (firm as { workflows_enabled?: boolean } | null)?.workflows_enabled ===
    true;

  const tab: VylanTab = sp.tab === "ai" ? "ai" : "jobs";

  const tabs = [
    { id: "jobs" as const, label: t("tab_jobs"), href: "/vylan" },
    { id: "ai" as const, label: t("tab_ai"), href: "/vylan?tab=ai" },
  ];

  return (
    <div className="mx-auto max-w-4xl animate-in-fade">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("page_title")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
          {t("page_subtitle")}
        </p>
      </header>

      <nav
        aria-label={t("page_title")}
        className="mb-6 flex items-center gap-6 border-b border-border"
      >
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {tab === "ai" ? (
        <AiPerformancePanel locale={locale} rangeParam={sp.range} />
      ) : (
        <>
          {workflowsOn && <AutomationsSection />}
          {/* With the library present, the scaffold's "coming soon" promise
              is fulfilled — hide it rather than promising what's above it. */}
          <AutomatedJobsPanel hideSoon={workflowsOn} />
        </>
      )}
    </div>
  );
}

async function AutomationsSection() {
  // Same signed-out guard as the AI panel below: the layout's redirect races
  // this render, and firing RLS'd reads as `anon` fills the log with denials
  // for a page that will never be shown.
  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);
  if (!firm || !user) return null;

  const [automations, useCounts, members] = await Promise.all([
    listAutomations(),
    listAutomationTemplateUseCounts(),
    listActiveFirmUsers(),
  ]);

  const rows: AutomationRow[] = automations.map((a) => ({
    id: a.id,
    firmId: a.firmId,
    name: a.name,
    definition: a.definition,
    usedBy: useCounts[a.id] ?? 0,
  }));

  return (
    <AutomationsPanel
      automations={rows}
      members={members.map((m) => ({
        id: m.id,
        name: m.display_name ?? m.name,
      }))}
    />
  );
}

async function AiPerformancePanel({
  locale,
  rangeParam,
}: {
  locale: "en" | "fr";
  rangeParam: string | undefined;
}) {
  const range = parseRange(rangeParam);

  // The firm's "reset stats" baseline (migration 0880) clamps every
  // range-scoped stat; the current user's role gates the owner-only reset
  // control. `performance_reset_at` may be undefined until 0880 is applied —
  // treated as "no reset". Unchanged from the retired Performance page.
  const [firm, user] = await Promise.all([getCurrentFirm(), getCurrentUser()]);

  // Signed out? Render nothing and, crucially, run no loaders.
  //
  // The app layout redirects an unauthenticated request to /login, but a Next
  // layout and the page below it render CONCURRENTLY — the redirect does not
  // preempt this component, so without this guard the loaders below fire first
  // as the `anon` role. The performance RPCs are definer functions with
  // `revoke all ... from public, anon` (0820), so every one of those calls is
  // correctly denied with 42501, and the console fills with
  // "permission denied for function perf_action_count" on requests that were
  // never going to render anything.
  //
  // That noise is what it looks like: alarming, and entirely self-inflicted.
  // The permissions are right, the fallback keeps the numbers right, and the
  // only real defect was doing the work at all for a request already on its
  // way to the login page.
  if (!firm || !user) return null;

  const resetAt = firm.performance_reset_at ?? null;
  const parsedReset = resetAt ? Date.parse(resetAt) : NaN;
  const resetAtMs = Number.isFinite(parsedReset) ? parsedReset : null;

  // `undefined` nowMs lets each loader read the clock itself (a lib function),
  // keeping this render pure; the reset baseline is threaded as the 3rd arg.
  const [ai, automation] = await Promise.all([
    loadAi(range, undefined, resetAtMs),
    loadAutomation(range, undefined, resetAtMs),
  ]);

  return (
    <AiPerformanceTab
      range={range}
      locale={locale}
      ai={ai}
      automation={automation}
      resetAt={resetAt}
      isOwner={user.role === "owner"}
    />
  );
}
