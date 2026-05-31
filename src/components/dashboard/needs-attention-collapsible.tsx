"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "vylan:needs-attention-collapsed";
const COLLAPSE_EVENT = "vylan:needs-attention-collapsed-changed";

// Persisted collapse state read through an external store (same pattern as the
// sidebar collapse) so there's no setState-in-effect and it stays in sync
// across tabs. The toggle writes localStorage + dispatches the event below.
function subscribe(callback: () => void) {
  window.addEventListener(COLLAPSE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

// Expanded on the server + first client paint (so hydration matches); the
// stored preference is applied immediately after.
function getServerSnapshot(): boolean {
  return false;
}

// Collapsible shell for the Overview "Needs attention" block. Keeps the
// accent-tinted panel + an always-visible header (warning icon + title + count
// badge + optional "View all"); the body (the rows, passed as children) slides
// open/closed via the grid-rows technique used elsewhere in the app. Default
// EXPANDED — it's the most useful block on the page, so collapsing is opt-in.
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
  const collapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const open = !collapsed;
  // Gate the height transition until after mount so restoring a collapsed
  // state snaps shut instead of animating closed on every page load.
  const [animate, setAnimate] = useState(false);
  const bodyId = "needs-attention-body";

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const toggle = () => {
    const next = !collapsed;
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage unavailable (private mode / blocked) — non-fatal.
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  };

  return (
    <section
      aria-labelledby="needs-attention-title"
      className="rounded-2xl border border-accent/30 bg-accent/[0.06] p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggle}
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

      <div
        id={bodyId}
        className={cn(
          "grid",
          animate &&
            "transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
        )}
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </section>
  );
}
