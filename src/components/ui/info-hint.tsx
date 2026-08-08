"use client";

// The little "i" that explains a number.
//
// Three surfaces wanted one within a week of each other — the Insights
// "Estimated" label, the Files search-scope hint, and now the client header's
// time bubble — and the first two had already drifted: one a focusable button
// with an aria-label, the other a span you could only reach with a mouse; one
// 288px wide, the other 260. Same idea, two answers, and a third about to be
// written. So it lives here once.
//
// Always a BUTTON, never a bare span: a hint you can only get at by hovering
// does not exist for a keyboard, and on a phone there is no hover at all.
// Radix opens the tooltip on focus as well as hover, so the button is what
// makes the explanation reachable — and `aria-label` carries the same words to
// a screen reader for the icon-only shape, which otherwise announces nothing.

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export function InfoHint({
  text,
  children,
  side,
  className,
  iconClassName,
  contentClassName,
}: {
  /** The explanation. Also the accessible name when there is no label. */
  text: string;
  /** Optional label rendered before the icon, inside the same trigger. */
  children?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  iconClassName?: string;
  contentClassName?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // A label makes the words the accessible name; without one the
            // icon has to carry them itself.
            aria-label={children == null ? text : undefined}
            className={cn(
              "inline-flex cursor-help items-center gap-1 rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            {children}
            <Info
              className={cn("size-3.5 shrink-0", iconClassName)}
              aria-hidden
            />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className={cn(
            "max-w-[260px] text-xs leading-relaxed",
            contentClassName,
          )}
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
