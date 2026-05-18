"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  HIGHLIGHT_EVENT,
  type HighlightDetail,
} from "./hash-section-link";

// Collapsible card used on the dashboard. Default collapsed. The
// header always shows: icon + title + count + a short "preview"
// string so the accountant can see what's inside without expanding.
// Empty sections (count = 0) render the same header but are not
// expandable — clicking them does nothing.
//
// Hash routing: when the URL hash matches this section's `id`
// (e.g. a KPI tile links to `#ai-activity`), the section auto-opens
// AND briefly highlights so the click feels like "show me this", not
// "scroll to a collapsed header". Listens to hashchange so a second
// click from the same page re-triggers the highlight.
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
  const [highlight, setHighlight] = useState(false);
  const isEmpty = count === 0;

  useEffect(() => {
    if (!id) return;
    let timeoutId: number | undefined;

    function trigger() {
      setOpen(true);
      setHighlight(true);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      // ~1.4s soft pulse — long enough to draw the eye, short
      // enough that it doesn't linger once the user starts reading.
      timeoutId = window.setTimeout(() => setHighlight(false), 1400);
    }

    // Initial mount: page was loaded with this section already in
    // the URL hash (direct nav / refresh / back-button).
    if (
      typeof window !== "undefined" &&
      window.location.hash.replace(/^#/, "") === id
    ) {
      trigger();
    }

    // Per-click: HashSectionLink dispatches an explicit event so
    // repeat clicks re-fire the highlight even when the hash hasn't
    // changed (browsers don't emit hashchange in that case).
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<HighlightDetail>).detail;
      if (detail?.id === id) trigger();
    }
    window.addEventListener(HIGHLIGHT_EVENT, onEvent);

    // Browser history back/forward: when the user navigates between
    // hash URLs (e.g. forward to a previously-highlighted section),
    // the component is already mounted, so the initial-mount check
    // above doesn't re-run. Listen for hashchange too.
    function onHashChange() {
      if (window.location.hash.replace(/^#/, "") === id) trigger();
    }
    window.addEventListener("hashchange", onHashChange);

    return () => {
      window.removeEventListener(HIGHLIGHT_EVENT, onEvent);
      window.removeEventListener("hashchange", onHashChange);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [id]);

  // Empty sections aren't expandable. Use a div header so the
  // affordance disappears and clicking does nothing.
  const HeaderEl = isEmpty ? "div" : "button";

  return (
    <section
      id={id}
      className={
        "scroll-mt-24 rounded-xl border bg-card animate-in-up overflow-hidden transition-[border-color,box-shadow] duration-300 " +
        (highlight
          ? "border-primary/60 shadow-[0_0_0_3px_rgba(99,102,241,0.18)]"
          : "border-border")
      }
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
