import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { FilingPanel } from "@/components/filing/filing-panel";
import { HomeTab } from "@/components/files/home-tab";
// The browse view lives in its own component so the CLIENT page can render the
// very same browser on its Files tab (Cohesion rule: one browser, two places,
// never two browsers).
import { BrowseTab } from "@/components/files/browse-tab";
import { resolveFilesTab, type FilesTab } from "@/lib/files/tabs";

// FILES — the firm-wide document browser.
//
// It behaves like a file manager, deliberately: ONE list at every level, folder
// rows you click into, a path bar showing where you are. Clients are folders,
// years are folders inside them, categories are folders inside those, and files
// are at the bottom — mirroring the exact folder structure the filing engine
// writes into the firm's cloud storage (Clients/{client}/{year}/{category}).
//
//   /files                                    the client folders
//   /files?client=<id>                        that client's year folders
//   /files?client=<id>&year=2024              its category folders
//   /files?client=<id>&year=2024&category=…   the files
//   /files?q=…                                firm-wide search (flat)
//   /files?tab=settings                       the relocated filing settings
//
// URL-as-state rather than client state: every folder is linkable and survives
// a reload, the filing OAuth callbacks land straight on ?tab=settings, and
// paging needs no JavaScript.
export const dynamic = "force-dynamic";

// Tab resolution lives in lib/files/tabs.ts: Home is the default for a BARE
// /files only — every pre-Home deep link (?client=…, ?q=…) still lands on
// Browse without any link anywhere changing.

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Files");
  const sp = await searchParams;

  const tab = resolveFilesTab(sp);
  const tabs: { id: FilesTab; label: string; href: string }[] = [
    { id: "home", label: t("tab_home"), href: "/files" },
    { id: "browse", label: t("tab_browse"), href: "/files?tab=browse" },
    { id: "settings", label: t("tab_settings"), href: "/files?tab=settings" },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl animate-in-fade">
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

      {tab === "settings" ? (
        <div className="max-w-4xl">
          <FilingPanel />
        </div>
      ) : tab === "browse" ? (
        <BrowseTab locale={locale} sp={sp} />
      ) : (
        <HomeTab locale={locale} />
      )}
    </div>
  );
}
