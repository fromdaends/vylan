import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

// THE FIRM'S NAVIGATION — tabs across the top, Canopy's client-page pattern.
//
// Not a second sidebar. Two earlier attempts put the firm nav in the wrong
// place (a card inside the content, then a rail beside the app's sidebar); the
// founder's call is tabs on top, and the reference screenshot is a client page
// with a title, a subtitle, and a single horizontal row of tabs under it, the
// active one carrying a solid underline.
//
// Why tabs suit this surface: every firm destination is a different VIEW OF THE
// SAME SUBJECT — this firm. A sidebar implies you have travelled somewhere
// else; tabs say you are still on the firm and looking at another facet of it.
//
// A pure SERVER component: real links, no client state, so the active tab is
// decided by which page rendered it rather than by JavaScript. Nothing crosses
// the RSC boundary and there is no hydration cost.
//
// DELIBERATELY NOT TOUCHING THE APP SIDEBAR. Another session is mid-way through
// a full rebuild of it, so this whole feature stays out of app-shell.tsx — the
// consequence is that the Firm button still opens the old team page and this
// lives at its own URL until that work lands.
export type FirmTabKey = "people" | "settings" | "billing" | "audit";

export function FirmTabs({
  current,
  labels,
}: {
  current: FirmTabKey;
  // Resolved by the calling page so this stays a thin, translation-free view.
  labels: Record<FirmTabKey, string>;
}) {
  // Every href below is a route that exists TODAY. The People tab used to point
  // at /firm/preview, a page that was deleted when this work moved onto the real
  // team page — so the first tab 404'd. Checked, not assumed, this time.
  const tabs: { key: FirmTabKey; href: string }[] = [
    // People IS this page. Self-linking is deliberate: the tab has to be
    // clickable-looking and consistent with the others, and it makes the row
    // work identically whichever tab you arrive on.
    { key: "people", href: "/settings/team" },
    // The FIRM's settings — the private-by-default switch, assignment email,
    // sign-off gate. Same destination as the "Firm settings" item in this page's
    // own ⋯ menu, so the two entry points agree.
    { key: "settings", href: "/settings?tab=team" },
    { key: "billing", href: "/billing" },
    { key: "audit", href: "/settings/audit" },
  ];

  return (
    // The row scrolls rather than wrapping: a tab strip that wraps onto a second
    // line stops reading as a strip. -mx/px pairs let it bleed to the content
    // edge on a phone while keeping the first tab aligned with the heading.
    <div className="-mx-4 overflow-x-auto border-b border-border/60 px-4 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max gap-1" aria-label="Firm">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                // The underline sits ON the container's border, so the active
                // tab reads as connected to the content below it rather than
                // as a floating pill.
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
                active
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {labels[tab.key]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
