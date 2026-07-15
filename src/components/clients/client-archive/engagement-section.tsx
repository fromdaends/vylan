"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

// One collapsible engagement block in the client document archive. Supports both
// UNCONTROLLED (internal state via defaultOpen) and CONTROLLED (open +
// onOpenChange) modes — the archive view drives it controlled so it can run
// expand-all / collapse-all and auto-expand-on-search across every section.
// `headerAction` (the per-engagement download button) sits OUTSIDE the toggle
// button so buttons never nest.
export function ArchiveEngagementSection({
  title,
  meta,
  countLabel,
  archivedLabel,
  archived,
  defaultOpen = false,
  open,
  onOpenChange,
  headerAction,
  children,
}: {
  title: string;
  meta: string;
  countLabel: string;
  archivedLabel: string;
  archived: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const toggle = () => {
    const next = !isOpen;
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3.5">
        {/* The engagement title is the section heading (h2); category labels
            inside are h3, so screen-reader heading navigation reflects the
            CLIENT > ENGAGEMENT > CATEGORY structure. The heading wraps the
            toggle button (a heading can't live inside a button). */}
        <h2 className="m-0 min-w-0 flex-1 text-base font-normal">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            className={cn(
              "-my-2 -ml-2 flex w-full cursor-pointer items-center gap-3 rounded-lg py-2 pl-2 pr-1 text-left transition-colors",
              "hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
          <span className="shrink-0 text-muted-foreground">
            {isOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium text-foreground">{title}</span>
              {archived && (
                <Badge variant="outline" className="text-[11px]">
                  {archivedLabel}
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>
          </span>
          <Badge variant="secondary" className="shrink-0">
            {countLabel}
          </Badge>
          </button>
        </h2>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      {isOpen && <div className="border-t border-border px-4 py-4">{children}</div>}
    </div>
  );
}
