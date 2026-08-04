"use client";

// A hairline at the top of the window that moves while a page is loading.
//
// The founder: "it happens a lot where, like, a page is taking forever to load.
// You know? So having one would be nice." — and asked for it "very, very
// subtly".
//
// The problem is real and specific to this kind of app. A Next.js App Router
// navigation renders on the SERVER, so between the click and the new screen
// there is a gap with no feedback at all: the old page just sits there looking
// like nothing happened. People click again, which queues a second navigation
// and makes it slower.
//
// ── WHY IT CREEPS AND NEVER ARRIVES ────────────────────────────────────────
//
// The bar eases toward 90% over ten seconds and stops. Nothing knows how long
// a server render will take, so a bar that claimed a real percentage would be
// lying; one that keeps moving without arriving says the true thing — "still
// working" — and the eased curve means it slows as it goes, which reads as
// effort rather than as a stall.
//
// It only jumps to 100% when the new page is actually here, and that final
// snap is the part people feel as "done".
//
// ── SUBTLE, ON PURPOSE ─────────────────────────────────────────────────────
//
// Two pixels, the accent blue, no glow, no spinner, no dimming. It sits above
// everything but is only visible while a page is in flight, which on a fast
// navigation is a flicker nobody consciously registers — that is the intent.
// A modal overlay or a centred spinner would make every navigation feel like
// an event.
//
// ── REDUCED MOTION ─────────────────────────────────────────────────────────
//
// The bar still appears — it is the only signal that anything is happening, and
// removing it would leave those users with the blank wait this exists to fix.
// What goes is the MOVEMENT: it shows at a fixed width instead of creeping.
// Reduced motion means no motion, not no information.
//
// ── HOW IT KNOWS ───────────────────────────────────────────────────────────
//
// The App Router has no router events, so: a capture-phase click listener
// starts it on any same-origin link that will actually navigate, and a change
// in pathname or query finishes it. popstate covers back and forward.
//
// A hard ceiling stops it too. Without one, a navigation that never resolves —
// a download link, a target=_blank the check missed, a route that throws —
// would leave a bar creeping at the top of the screen forever, which is worse
// than no bar at all.

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

// The creep (10s to 90%) and the finish (180ms + a 250ms fade) live in the
// classes below, next to the thing they describe. Only the two the JS needs are
// constants.
/** How long the finish takes, start to invisible — when to unmount. */
const FINISH_TOTAL_MS = 430;
/** Nothing may leave the bar running longer than this. */
const MAX_MS = 20000;

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timers = useRef<number[]>([]);

  // The URL as the bar cares about it. A query-only navigation is still a
  // navigation — /work?due=overdue leaves the pathname alone, and without the
  // query here the bar would start and never finish.
  const url = `${pathname}?${searchParams}`;
  const seen = useRef(url);

  function clearTimers() {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }

  // ── start: any click that is about to navigate in-app ────────────────────
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Modified clicks open a new tab; the current page is not going anywhere.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let next: URL;
      try {
        next = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (next.origin !== window.location.origin) return;
      // Same page — nothing will load, so nothing should be shown.
      if (
        next.pathname === window.location.pathname &&
        next.search === window.location.search
      ) {
        return;
      }

      clearTimers();
      setState("loading");
      timers.current.push(
        window.setTimeout(() => setState("idle"), MAX_MS),
      );
    }

    // Back and forward never go through a link, so they need their own start.
    // Named rather than inline, or the cleanup below removes nothing and every
    // remount leaves another listener behind.
    function onPopState() {
      setState("loading");
    }

    // Capture, so it runs before a framework handler can stop propagation.
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // ── finish: the new page is here ─────────────────────────────────────────
  useEffect(() => {
    if (seen.current === url) return;
    seen.current = url;
    clearTimers();
    setState("done");
    timers.current.push(
      window.setTimeout(() => setState("idle"), FINISH_TOTAL_MS),
    );
  }, [url]);

  useEffect(() => clearTimers, []);

  if (state === "idle") return null;

  return (
    <div
      // Not a live region and not announced: a screen reader already gets the
      // new page. This is for the eyes that are watching an unchanged screen.
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
    >
      <div
        className={cn(
          "h-full bg-accent",
          state === "done"
            ? // The snap to full, then a fade. Two durations on one transition,
              // the opacity delayed until the width has arrived, so it reads as
              // "finished, then gone" rather than both at once.
              "w-full opacity-0 transition-[width,opacity] [transition-delay:0ms,180ms] [transition-duration:180ms,250ms]"
            : // A KEYFRAME, not a transition: an element that has just mounted
              // has nothing to transition FROM, and the two-frame dance to give
              // it one is exactly the fragility that made the rail flyout snap.
              // motion-reduce holds it at a third and still: the bar is the only
              // signal anything is happening, so it stays — the MOVEMENT goes.
              "w-[90%] animate-[route-progress_10s_cubic-bezier(0.1,0.85,0.25,1)_forwards] motion-reduce:w-1/3 motion-reduce:animate-none",
        )}
      />
    </div>
  );
}
