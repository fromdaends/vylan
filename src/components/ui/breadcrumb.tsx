import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

export type BreadcrumbItem = {
  // Already-translated text for the segment (bilingual is the caller's job).
  label: string;
  // Link target for the segment. Omit for a non-navigable crumb; the final
  // crumb is always rendered as the current page and is never a link.
  href?: string;
};

// One reusable breadcrumb trail — Section › Sub-section › Current item. Muted,
// chevron-separated path links with a brighter, non-interactive current page.
// Server-renderable (no client hooks) so it drops straight into the server
// detail pages. Pass `label` as the translated accessible name for the <nav>.
export function Breadcrumb({
  items,
  label = "Breadcrumb",
  className,
}: {
  items: BreadcrumbItem[];
  label?: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  const lastIndex = items.length - 1;
  // Deep trails (>3 segments) collapse their interior crumbs behind a single
  // ellipsis on mobile so the path never wraps; desktop shows the full trail.
  // Most trails here are 2–3 deep, so this is a graceful-degradation safety net
  // on top of truncating the (long) current segment.
  const hasCollapse = items.length > 3;

  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, i) => {
          const isCurrent = i === lastIndex;
          // Interior crumb of a deep trail: hidden on mobile, shown on desktop.
          const isCollapsed = hasCollapse && i > 0 && i < lastIndex - 1;
          // The single mobile "…" placeholder sits just before the last-but-one
          // crumb (which stays visible alongside the first crumb + current).
          const showEllipsis = hasCollapse && i === lastIndex - 1;

          return (
            <Fragment key={i}>
              {showEllipsis && (
                <li
                  aria-hidden
                  className="flex items-center gap-1.5 text-muted-foreground/70 sm:hidden"
                >
                  <ChevronRight className="size-3.5 shrink-0" />
                  <span>…</span>
                </li>
              )}
              <li
                className={cn(
                  "flex items-center gap-1.5",
                  isCurrent ? "min-w-0" : "shrink-0",
                  isCollapsed && "hidden sm:flex",
                )}
              >
                {i > 0 && (
                  <ChevronRight
                    className="size-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                )}
                {isCurrent ? (
                  <span
                    aria-current="page"
                    className="truncate font-medium text-foreground"
                  >
                    {item.label}
                  </span>
                ) : item.href ? (
                  <Link
                    href={item.href}
                    className="whitespace-nowrap transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="whitespace-nowrap">{item.label}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
