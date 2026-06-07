"use client";

import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

const STORAGE_KEY = "vylan:whats-new-collapsed";
const COLLAPSE_EVENT = "vylan:whats-new-collapsed-changed";

// Persisted collapse state via an external store (same pattern as the sidebar +
// Needs-attention block): no setState-in-effect, stays in sync across tabs AND
// across the two instances of this feed (mobile inline + desktop rail) that
// share one key. The toggle writes localStorage + dispatches the event.
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

// Expanded on the server + first client paint (hydration match); the stored
// preference is applied immediately after.
function getServerSnapshot(): boolean {
  return false;
}

// Collapsible shell for the Overview "What's new" feed. Keeps the quiet, neutral
// treatment (no accent tint — it answers "what happened", not "what to do") with
// an always-visible header (chevron + title + count + optional "View all"); the
// body (the feed rows, passed as children) slides open/closed via the grid-rows
// technique used elsewhere. Default EXPANDED; collapsing is opt-in and
// remembered. useId keeps the aria ids unique (this renders twice on the page).
export function WhatsNewCollapsible({
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
  // Gate the height transition until after mount so a restored collapsed state
  // snaps shut instead of animating closed on every load.
  const [animate, setAnimate] = useState(false);
  const uid = useId();
  const bodyId = `whats-new-body-${uid}`;
  const titleId = `whats-new-title-${uid}`;

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
    <section aria-labelledby={titleId} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="-mx-2 -my-1 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold tracking-tight text-foreground transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
          <span id={titleId} className="truncate">
            {title}
          </span>
          {count > 0 && (
            <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-secondary px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </button>
        {open && viewAll}
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
