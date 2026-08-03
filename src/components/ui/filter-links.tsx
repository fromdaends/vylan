import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

// A row of quiet filter links with optional counts — the lifecycle filter that
// sits in a Panel's header band beside its title (Active / Ready / Completed /
// Archived).
//
// LINKS, not buttons, everywhere this is used: each one changes which database
// scope the server loads, so it is a navigation. Writing it as a link is what
// makes it middle-clickable, bookmarkable and back-button-correct, and it is
// why the component takes hrefs rather than a callback.
//
// ONE component for the client page's Engagements tab and the teammate
// profile's, which had grown their own near-identical pill rows (one with
// counts, one without). Per the repo's Cohesion rule, the second surface gets
// the same object with a prop, not a copy — `count` is simply optional.
//
// A plain server-safe module: no state, no "use client".
export type FilterLinkItem = {
  key: string;
  href: string;
  label: string;
  active: boolean;
  // Omit when the caller genuinely does not know. A count that was never
  // loaded must be ABSENT rather than 0 — "not counted" and "none" are
  // different facts, and printing the wrong one reads as a bug.
  count?: number;
};

export function FilterLinks({
  items,
  label,
}: {
  items: FilterLinkItem[];
  /** Accessible name — usually the title of the section being filtered. */
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm transition-colors",
            item.active
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {item.label}
          {item.count !== undefined && (
            <span
              className={cn(
                "ml-1.5 tabular-nums",
                item.active
                  ? "text-muted-foreground"
                  : "text-muted-foreground/70",
              )}
            >
              {item.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
