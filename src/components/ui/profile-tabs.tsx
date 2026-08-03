import { Link } from "@/i18n/navigation";

// The tab row that sits on the bottom edge of a profile's header card, active
// tab underlined — Canopy's treatment, and the shape both of this app's profile
// pages use.
//
// ONE component, used by the client page and the teammate page. It started as
// inline JSX on the client page; the teammate page was about to grow a second
// copy, which is exactly the drift the repo's Cohesion rule names ("a feature
// built on two screens only gets updated on one"). A shared piece means the day
// someone restyles a tab row, both pages move.
//
// The tabs NAVIGATE rather than toggling client state: a tab is then linkable,
// opens in a new browser tab, and the back button works. It also means each
// page can load only the data the chosen tab renders, which is what keeps a tab
// switch cheap.
//
// A plain server-safe module — no state, no "use client" — so a Server
// Component renders it directly.
export type ProfileTabItem = {
  /** Stable key. Also the value the page's own parser reads out of the URL. */
  key: string;
  href: string;
  label: string;
  active: boolean;
};

export function ProfileTabs({
  items,
  label,
}: {
  items: ProfileTabItem[];
  /** Accessible name for the nav — usually whose profile this is. */
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      // Scrolls rather than wraps on a narrow screen: a tab row that becomes
      // two rows moves the page content down and stops reading as one edge.
      className="flex gap-1 overflow-x-auto border-t border-border/60 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={
            item.active
              ? "-mb-px whitespace-nowrap border-b-2 border-foreground px-3 py-2.5 text-sm font-medium text-foreground"
              : "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
