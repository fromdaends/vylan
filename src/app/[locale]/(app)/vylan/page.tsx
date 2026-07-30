import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { FilingPanel } from "@/components/filing/filing-panel";
import { AutomatedJobsPanel } from "@/components/vylan/automated-jobs-panel";

// Live connection + settings state (the filing tab) — never serve a cached
// "Not connected".
export const dynamic = "force-dynamic";

// The "Vylan" hub: the firm's own automation surface, reached from the rail's
// Sparkles tab. Two tabs today —
//   • Automated jobs   — custom, per-client automations (scaffolded; see the panel)
//   • Document filing  — the cloud-storage filing engine, moved here from
//                        /integrations/filing, which now redirects in
//
// Filing lived under Integrations because its providers (Drive / SharePoint /
// Dropbox / SmartVault) are third-party connections. But the FEATURE is
// Vylan-native automation, not an integration, so it belongs beside the other
// automated jobs. The rail's standalone Filing tab is retired in favour of this.
//
// Tab state is a plain ?tab= search param rather than client state: each tab is
// server-rendered with its own data, and the URL stays shareable/linkable (the
// filing OAuth callbacks redirect straight to ?tab=filing).
type Tab = "jobs" | "filing";

export default async function VylanHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("VylanHub");

  const sp = await searchParams;
  const tab: Tab = sp.tab === "filing" ? "filing" : "jobs";

  const tabs: { id: Tab; label: string; href: string }[] = [
    { id: "jobs", label: t("tab_jobs"), href: "/vylan" },
    { id: "filing", label: t("tab_filing"), href: "/vylan?tab=filing" },
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

      {/* Underlined tab strip, matching the Engagements / dashboard pattern. */}
      <nav
        aria-label={t("page_title")}
        className="mb-8 flex items-center gap-6 border-b border-border"
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

      {tab === "filing" ? <FilingPanel /> : <AutomatedJobsPanel />}
    </div>
  );
}
