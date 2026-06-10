"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

// Collapsible shell for the Overview "Needs attention" block. Keeps the
// accent-tinted panel + an always-visible header (warning icon + title + count
// badge + optional "View all"); the body (the rows, passed as children) slides
// open/closed via the grid-rows technique used elsewhere in the app.
//
// ALWAYS opens EXPANDED on page load — it's the most useful block on the page.
// The toggle still lets the user close it for the current view, but the choice
// is deliberately NOT persisted: an old saved "collapsed" preference used to
// keep the block shut on every load, which buried the to-do list. (The old
// localStorage key "vylan:needs-attention-collapsed" is simply ignored now.)
export function NeedsAttentionCollapsible({
  title,
  count,
  viewAll,
  children,
}: {
  title: string;
  count: number;
  viewAll?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const open = !collapsed;
  const bodyId = "needs-attention-body";

  return (
    <section
      aria-labelledby="needs-attention-title"
      className="border-l-2 border-accent/40 pl-4 sm:pl-5"
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="-mx-2 -my-1 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-base font-semibold tracking-tight text-foreground transition-colors hover:bg-accent/10"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-accent transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
          <AlertTriangle className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span id="needs-attention-title" className="truncate">
            {title}
          </span>
          {count > 0 && (
            <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 px-1.5 text-xs font-semibold tabular-nums text-accent">
              {count}
            </span>
          )}
        </button>
        {viewAll}
      </div>

      {/* Always mounts open, so the transition only ever runs on a real user
          toggle — no snap-shut gating needed anymore. */}
      <div
        id={bodyId}
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </section>
  );
}
