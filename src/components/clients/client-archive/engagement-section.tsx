"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

// One collapsible engagement block in the client document archive. The header
// (title, type, date, archived marker, file count) and the body (the category
// groups + file rows) are server-rendered and passed in; this thin client shell
// only owns open/closed state — the same pattern the checklist uses so server
// data can live inside a collapsible. `headerAction` (the per-engagement
// download button) sits OUTSIDE the toggle button so we never nest buttons.
export function ArchiveEngagementSection({
  title,
  meta,
  countLabel,
  archivedLabel,
  archived,
  defaultOpen,
  headerAction,
  children,
}: {
  title: string;
  meta: string;
  countLabel: string;
  archivedLabel: string;
  archived: boolean;
  defaultOpen: boolean;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            "-my-2 -ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg py-2 pl-2 pr-1 text-left transition-colors",
            "hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span className="shrink-0 text-muted-foreground">
            {open ? (
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
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      {open && <div className="border-t border-border px-4 py-4">{children}</div>}
    </div>
  );
}
