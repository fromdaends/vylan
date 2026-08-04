"use client";

// The overflow beside "New engagement", where Canopy keeps its ⋮ too.
//
// ⚠️ THIS EXISTS SO THAT NARROWING THE TABS DID NOT DELETE ANYTHING. The
// founder: "delete that whole top line... The only top tab things should be:
// Active, Drafts, All engagements." Four views came off that strip, and three
// of them had no other way in:
//
//   • Ready to review — a slice of live work
//   • Archived — deliberately put away
//   • Recently deleted — a 30-DAY RECOVERY WINDOW with a purge cron on the
//     other side of it. Unreachable here would mean unrecoverable there.
//
// Completed is the exception and needs no row: All engagements contains it, and
// the Status column menu filters to it.

import { MoreHorizontal } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function EngagementViewsMenu({
  items,
  label,
}: {
  /** In display order. `count` renders only when > 0. */
  items: { href: string; label: string; count?: number }[];
  /** Accessible name for the trigger — it has no visible text. */
  label: string;
}) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href} className="flex items-center justify-between gap-3">
              <span>{item.label}</span>
              {item.count != null && item.count > 0 && (
                <span className="tabular-nums text-xs text-muted-foreground">
                  {item.count}
                </span>
              )}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
