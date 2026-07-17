import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { ArrowRight } from "lucide-react";

// One tile in the Integrations index grid. Presentational + link-only, so it
// stays a server component. Each integration owns its own card: QuickBooks shows
// a connection state, Sage 50 shows a "file export" marker (nothing to connect
// to). The two are fully independent — this card knows nothing about the others.
export type IntegrationCardBadge = {
  label: string;
  // Visual weight of the pill. "success" = connected (green), "muted" = neutral
  // marker (e.g. "File export"), "warning" = attention (e.g. sandbox/dead).
  tone: "success" | "muted" | "warning";
};

export function IntegrationCard({
  href,
  logo,
  name,
  description,
  badge,
  actionLabel,
  // A soft brand-tinted ring/tile behind the logo (e.g. QuickBooks green). Pass
  // a Tailwind-safe class string; falls back to the neutral secondary tile.
  tileClassName,
}: {
  href: string;
  logo: ReactNode;
  name: string;
  description: string;
  badge?: IntegrationCardBadge;
  actionLabel: string;
  tileClassName?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col rounded-2xl border border-border/60 bg-card/40 p-5 transition-all",
        "hover:border-border hover:bg-card/70 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-xl ring-1 ring-inset",
            tileClassName ?? "bg-secondary/60 ring-border/50",
          )}
        >
          {logo}
        </span>
        {badge && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
              badge.tone === "success" &&
                "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
              badge.tone === "warning" && "bg-warning/15 text-warning",
              badge.tone === "muted" &&
                "bg-secondary text-muted-foreground",
            )}
          >
            {badge.tone === "success" && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            )}
            {badge.label}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{name}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="mt-5 flex items-center gap-1.5 text-sm font-medium text-foreground/80 transition-colors group-hover:text-foreground">
        {actionLabel}
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
    </Link>
  );
}
