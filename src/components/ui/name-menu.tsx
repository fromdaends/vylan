"use client";

// A page's NAME, with a dropdown behind it.
//
// Discord's server menu is the reference: the name at the top carries a
// chevron, and everything you can do to the thing hangs off it rather than off
// an anonymous "⋯" beside it. The founder asked for the same treatment on the
// firm page and then on the client page — "literally do the exact same thing" —
// so the trigger lives here ONCE and each surface supplies only its own items.
//
// Two copies of this would be the drift the repo's cohesion rule names: the
// day they are written they look identical, and six months later one of them
// still opens on the left while the other opens under the arrow.

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NameMenu({
  name,
  label,
  enabled = true,
  className,
  children,
}: {
  name: string;
  /** Screen-reader name for the trigger, e.g. "Firm options". */
  label: string;
  /** When false the name renders as a plain heading — see below. */
  enabled?: boolean;
  /** Extra classes for the heading text (size differs per surface). */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // A chevron that opens a menu of things you cannot do is worse than no
  // chevron, so a viewer without the actions gets the heading alone.
  if (!enabled) {
    return (
      <h1 className={cn("truncate font-semibold tracking-tight", className)}>
        {name}
      </h1>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex min-w-0 items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h1 className={cn("truncate font-semibold tracking-tight", className)}>
            {name}
          </h1>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
              open && "rotate-180",
            )}
            aria-hidden
          />
          <span className="sr-only">{label}</span>
        </button>
      </DropdownMenuTrigger>
      {/* Anchored to the END of the trigger, which is where the chevron is.
          align="start" hangs the menu off the first letter of a long name —
          a whole heading away from the arrow you just clicked. */}
      <DropdownMenuContent align="end" sideOffset={6} className="w-60">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
