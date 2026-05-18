"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// Collapsible card used on the dashboard. Default collapsed. The
// header always shows: icon + title + count + a short "preview"
// string so the accountant can see what's inside without expanding.
// Empty sections (count = 0) render the same header but are not
// expandable — clicking them does nothing.
export function CollapsibleSection({
  id,
  title,
  count,
  preview,
  hint,
  icon,
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  count: number;
  preview?: string | null;
  hint?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isEmpty = count === 0;
  // Empty sections aren't expandable. Use a div header so the
  // affordance disappears and clicking does nothing.
  const HeaderEl = isEmpty ? "div" : "button";

  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-xl border border-border bg-card animate-in-up overflow-hidden"
    >
      <HeaderEl
        type={isEmpty ? undefined : "button"}
        onClick={isEmpty ? undefined : () => setOpen((v) => !v)}
        aria-expanded={isEmpty ? undefined : open}
        className={
          "w-full text-left px-5 py-4 flex items-center gap-3 " +
          (isEmpty
            ? "cursor-default opacity-70"
            : "cursor-pointer hover:bg-secondary/30 transition-colors")
        }
      >
        {!isEmpty && (
          <ChevronRight
            className={
              "h-4 w-4 text-muted-foreground transition-transform shrink-0 " +
              (open ? "rotate-90" : "")
            }
            aria-hidden
          />
        )}
        {isEmpty && (
          <div className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <div className="flex items-center gap-2 text-sm font-medium shrink-0">
          {icon}
          <span>{title}</span>
          <span className="text-muted-foreground font-normal tabular-nums">
            ({count})
          </span>
        </div>
        {preview && (
          <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate text-right hidden sm:block">
            {preview}
          </div>
        )}
      </HeaderEl>
      {!isEmpty && open && (
        <div className="border-t border-border/60 px-5">
          {hint && (
            <p className="text-xs text-muted-foreground py-3 -mb-1">
              {hint}
            </p>
          )}
          <div className="py-2">{children}</div>
        </div>
      )}
    </section>
  );
}
