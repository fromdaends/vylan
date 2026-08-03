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
import { HeaderSearch } from "@/components/ui/header-search";
import { NewMenu } from "@/components/files/new-menu";
import { listClientOptions } from "@/lib/db/clients";
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

  // The "+ New" button moved OUT of Browse and into the page header, so it is
  // reachable from Home too. Browse therefore stops drawing its own copy —
  // see BrowseTab's `hostedChrome` prop — rather than the two coexisting.
  // Filing settings hides it entirely: Save is that screen's one colored
  // button, and the UI kit allows exactly one per screen.
  const showNew = tab !== "settings";
  const clients = showNew ? await listClientOptions() : [];

  return (
    // FULL WIDTH, not a centered 1024px column: this is a file manager, and a
    // file manager that leaves half the monitor empty reads as a web page about
    // files rather than the thing itself.
    <div className="w-full animate-in-fade px-6 pt-7 pb-18 lg:px-11">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-[26px] font-[650] tracking-[-0.02em]">
            {t("page_title")}
          </h1>
          <p className="mt-[5px] text-sm text-muted-foreground">
            {t("page_subtitle")}
          </p>
        </div>
        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          {/* Typing switches to Browse — Home has no result list to filter. */}
          <HeaderSearch
            basePath="/files"
            placeholder={t("search_all_placeholder")}
            forceParams={{ tab: "browse" }}
          />
          {showNew && (
            <NewMenu
              clients={clients}
              clientId={sp.client?.trim() ?? null}
              folderParentId={sp.folder?.trim() ?? null}
            />
          )}
        </div>
      </header>

      <nav
        aria-label={t("page_title")}
        className="mt-[22px] mb-6 flex items-center gap-[26px] border-b border-border"
      >
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-0.5 pb-[11px] text-sm transition-colors",
                active
                  ? "border-accent font-semibold text-foreground"
                  : "border-transparent font-medium text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {tab === "settings" ? (
        <FilingPanel />
      ) : tab === "browse" ? (
        <BrowseTab locale={locale} sp={sp} hostedChrome />
      ) : (
        <HomeTab locale={locale} />
      )}
    </div>
  );
}
