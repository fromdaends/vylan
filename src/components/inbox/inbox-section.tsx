"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// A collapsible Inbox section. The whole header row is the toggle (not just
// the caret); the caret points right when collapsed and rotates down when
// open. Content uses the grid-rows 0fr↔1fr technique for a smooth,
// content-height-agnostic expand/collapse — no max-height guessing. The
// header keeps the same look as the page's non-collapsible sections, so the
// three sections read as one consistent set.
export function InboxSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section aria-label={title}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="group flex w-full items-center gap-2 text-left"
      >
        <ChevronRight
          className={
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:text-foreground " +
            (open ? "rotate-90" : "")
          }
          aria-hidden
        />
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </button>

      <div
        id={contentId}
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        {/* overflow-hidden clips the content while the row collapses; the
            inner pt-4 gives the gap below the header only when expanded (it's
            clipped at 0fr, so a collapsed section has no trailing space). */}
        <div className="overflow-hidden">
          <div className="pt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
