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
export type FirmTabKey = "people" | "settings" | "roles";

export function FirmTabs({
  current,
  labels,
  teamEnabled = true,
}: {
  current: FirmTabKey;
  // Resolved by the calling page so this stays a thin, translation-free view.
  labels: Record<FirmTabKey, string>;
  // With collaboration off there is nobody to wear a role, so the tab is not
  // offered. It must be HIDDEN rather than merely inert: the page refuses the
  // view for a solo firm, so a visible tab would quietly bounce you back to
  // People and read as a broken link.
  teamEnabled?: boolean;
}) {
  // Views of THIS page, switched by ?tab=. Nothing here leaves the firm.
  //
  // Billing and the audit log used to sit here and should not have: they are
  // their own destinations elsewhere in the app, and a tab row whose items
  // navigate away is a link list wearing a tab row's clothes. They were my
  // invention, not a requirement.
  //
  // "Settings", not "Firm": the rail's entry for this whole page is already
  // called Firm, so a Firm tab inside the Firm page names the container twice
  // and tells you nothing about which half you are on.
  //
  // ROLES joined them. It was a separate route reached only from the firm
  // name's dropdown, which put it on the wrong side of this page's rule — a
  // place you LOOK AT is a tab, a thing you DO is in the dropdown, and nothing
  // is in both. Roles is unambiguously a place: you open it and read who can
  // do what. It left the dropdown in the same change that brought it here.
  //
  // It sits between People and Settings on purpose: it is about the people
  // above it, and it is not one of the firm's own switches.
  const tabs: { key: FirmTabKey; href: string }[] = [
    { key: "people", href: "/settings/team" },
    ...(teamEnabled
      ? [{ key: "roles" as const, href: "/settings/team?tab=roles" }]
      : []),
    { key: "settings", href: "/settings/team?tab=settings" },
  ];

  return (
    // The row scrolls rather than wrapping: a tab strip that wraps onto a second
    // line stops reading as a strip.
    //
    // It lives INSIDE the header card now (see TeamManager), on its bottom
    // edge, so the border here is a top border joining it to the identity above
    // rather than a bottom border floating over the content below. Same
    // treatment as the client and teammate pages.
    <div className="overflow-x-auto border-t border-border/60 px-2">
      <nav className="flex min-w-max" aria-label="Firm">
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
