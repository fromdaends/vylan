"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

// Collapsible wrapper for one checklist item. The item's header (label, status,
// approve/reject controls) is server-rendered and passed as `summary`; the body
// (uploaded files + any rejection reason) is `children` and only mounts when
// open. Server components can't hold open/closed state, so this thin client
// shell owns it while everything inside stays server-rendered.
//
// Default state is decided by the caller (resolved items start collapsed so a
// long checklist reads as a calm list of headers; items that need the
// accountant's eye start open).
export function ChecklistItemShell({
  defaultOpen,
  collapsible,
  summary,
  children,
}: {
  defaultOpen: boolean;
  // False when there's nothing to reveal (no files, no reason) — then we render
  // a plain row with no chevron.
  collapsible: boolean;
  summary: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <li className="rounded-lg border border-border/60 bg-card/30 transition-colors hover:border-border">
      <div className="flex items-start gap-2 p-3 sm:p-3.5">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-0.5 shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">{summary}</div>
      </div>
      {collapsible && open && children && (
        <div className={cn("space-y-2 px-3 pb-3 sm:px-3.5", "pl-9 sm:pl-10")}>
          {children}
        </div>
      )}
    </li>
  );
}
