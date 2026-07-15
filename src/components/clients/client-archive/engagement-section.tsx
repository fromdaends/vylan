"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

// One collapsible engagement block in the client document archive. The header
// (title, type, date, archived marker, file count) and the body (the category
// groups + file rows) are server-rendered and passed in; this thin client shell
// only owns open/closed state — the same pattern the checklist uses so server
// data can live inside a collapsible.
export function ArchiveEngagementSection({
  title,
  meta,
  countLabel,
  archivedLabel,
  archived,
  defaultOpen,
  children,
}: {
  title: string;
  meta: string;
  countLabel: string;
  archivedLabel: string;
  archived: boolean;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors",
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
      {open && <div className="border-t border-border px-4 py-4">{children}</div>}
    </div>
  );
}
