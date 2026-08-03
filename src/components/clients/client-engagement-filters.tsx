// The locale-aware Link, same as the page's — next/link here would drop the
// /en or /fr prefix and bounce every filter click through the middleware.
import { Link } from "@/i18n/navigation";
import {
  CLIENT_ENGAGEMENT_VIEWS,
  clientEngagementViewHref,
  type ClientEngagementView,
} from "@/lib/clients/tabs";
import { cn } from "@/lib/cn";

// The Engagements tab's lifecycle filter: Active / Ready / Completed /
// Archived, with a live count on each.
//
// LINKS, not buttons. Each one changes which database scope the server loads,
// so it is a navigation, and writing it as a link is what makes it
// middle-clickable, bookmarkable and back-button-correct. A client-side toggle
// here would have to hold all four row sets in memory to be honest, which is
// three queries nobody asked for.
//
// A count is only rendered when the caller HAS one. The archived count is not
// free (different scope, second query), so rather than run it to print a number
// the filter shows no number there until you are on it — an absent count reads
// as "not counted", a wrong one reads as a bug.
export function ClientEngagementFilters({
  clientId,
  current,
  counts,
  labels,
}: {
  clientId: string;
  current: ClientEngagementView;
  counts: Partial<Record<ClientEngagementView, number>>;
  labels: Record<ClientEngagementView, string>;
}) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1"
      aria-label={labels[current]}
    >
      {CLIENT_ENGAGEMENT_VIEWS.map((view) => {
        const active = view === current;
        const count = counts[view];
        return (
          <Link
            key={view}
            href={clientEngagementViewHref(clientId, view)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {labels[view]}
            {count !== undefined && (
              <span
                className={cn(
                  "ml-1.5 tabular-nums",
                  active ? "text-muted-foreground" : "text-muted-foreground/70",
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
