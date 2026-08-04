"use client";

// The one row of view tabs, for every list that has saved views.
//
// The founder, pointing at the engagements page: "remove the top header sorter
// buttons... it doesnt align with canopys design and neither the task view
// page."
//
// ── WHAT ACTUALLY CAME OUT ─────────────────────────────────────────────────
//
// The BUTTONS, not the views. Both references they named have this exact row —
// Canopy's reads "Active | All Engagements | Awaiting Acceptance | Drafts", and
// the Tasks page's reads "Active work | My work | All work". What neither has
// is what the engagements page had: a filled pill around the active view and
// coloured badge chips around the counts, which is why that row read as a strip
// of buttons rather than as tabs.
//
// So this is the Tasks page's treatment, promoted out of tasks-table into a
// piece both screens use: quiet text, a 2px underline under the current one,
// the count as a plain number beside the label. Deleting the views themselves
// would have been the opposite of the stated goal, and would have stranded
// Drafts, Completed, Archived and Recently deleted — four routes with no other
// way in.
//
// ── ONE COMPONENT, TWO KINDS OF SWITCH ─────────────────────────────────────
//
// The Tasks page switches views in local state; engagements are separate ROUTES
// (each sub-page loads different rows on the server). So a tab takes EITHER an
// href or a key to hand back — never both — and the strip looks identical
// whichever it is. That is the whole reason this is one component: the day they
// were written the two rows looked the same, and by the time the founder saw
// them side by side they did not.

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

export type ViewTab = {
  /** Stable id, and what `onSelect` hands back. */
  key: string;
  label: string;
  /** Omit for no number. 0 still renders — "none here" is an answer. */
  count?: number | null;
  /** Present ⇒ the tab is a link to its own route. */
  href?: string;
  /**
   * Colours the COUNT only, never the tab. Recently deleted is the one view
   * whose number is a warning rather than a total, and losing that entirely
   * with the badge chips would have thrown away real information.
   */
  tone?: "default" | "destructive";
};

export function ViewTabs({
  tabs,
  activeKey,
  onSelect,
  ariaLabel,
  className,
}: {
  tabs: ViewTab[];
  activeKey: string;
  /** For state-switched strips. Ignored on tabs that carry an href. */
  onSelect?: (key: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap items-center gap-1 border-b border-border",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        // -mb-px so the active tab's underline sits ON the strip's own rule
        // instead of below it — two parallel lines one pixel apart is the
        // detail that makes a tab row look approximate.
        const classes = cn(
          "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
          active
            ? "border-foreground font-semibold text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground",
        );
        const body = (
          <>
            {tab.label}
            {tab.count != null && (
              <span
                className={cn(
                  "ml-1 tabular-nums",
                  tab.tone === "destructive"
                    ? "text-destructive"
                    : "opacity-60",
                )}
              >
                {tab.count}
              </span>
            )}
          </>
        );

        return tab.href ? (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            className={classes}
          >
            {body}
          </Link>
        ) : (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect?.(tab.key)}
            className={classes}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
