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
// ── A SEGMENT THAT CROSSES, NOT A BAR THAT FILLS ───────────────────────────
//
// Founder: "make the line more subtle more smooth and the line crosses from
// left to right."
//
// The first version filled from the left toward 90%. A filling bar has to claim
// a POSITION, and nothing can know how far along a server render is — so it was
// asserting something it could not know, and it needed a fake ceiling to avoid
// lying outright. A short segment that simply travels says "working" without
// asserting anything, loops for as long as the wait lasts, and is quieter:
// most of the line is empty at any given moment.
//
// It does not snap to full at the end either. There is nothing to fill; it just
// stops being there.
//
// ⚠️ AND IT STAYS UP FOR AT LEAST 400ms. Next prefetches every <Link> in view,
// so most navigations here land in under 50ms; without a floor the bar mounts
// and unmounts inside three frames and reads as nothing happening — which is
// exactly the complaint it exists to answer. A correct bar nobody can see is
// not a bar.
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
/** The fade at the end, after which it unmounts. */
const FINISH_TOTAL_MS = 320;
/** Nothing may leave the bar running longer than this. */
const MAX_MS = 20000;
/**
 * How long one crossing takes. MUST match the duration in the animate- class
 * below — a test asserts it, because the two drifting apart is exactly the bug
 * the founder caught.
 */
const SWEEP_MS = 800;

/**
 * The floor: once the bar is up it stays up for one WHOLE crossing, even if the
 * page arrived in three frames.
 *
 * ⚠️ THE BUG THIS FIXES. It used to be 400ms against a 1600ms sweep, so on a
 * fast page the segment got a quarter of the way across and vanished. The
 * founder: "it only crosses, like, the first quarter of the top of the screen."
 * That is 400/1600 exactly — it was not stopping deliberately, it was being cut
 * off mid-journey, which reads as the load having failed.
 *
 * Tying the floor TO the sweep is what makes that unrepresentable: the segment
 * always completes at least one full pass, left edge to right edge.
 */
const MIN_VISIBLE_MS = SWEEP_MS;

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
  /** When the current run started, so the floor above can be honoured. */
  const startedAt = useRef(0);

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
      startedAt.current = Date.now();
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

    // Hold the floor. A prefetched page arrives in a few frames, and finishing
    // that fast means the bar was technically correct and completely invisible.
    const elapsed = startedAt.current ? Date.now() - startedAt.current : 0;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);

    const finish = () => {
      setState("done");
      timers.current.push(
        window.setTimeout(() => setState("idle"), FINISH_TOTAL_MS),
      );
    };
    if (wait === 0) finish();
    else timers.current.push(window.setTimeout(finish, wait));
  }, [url]);

  useEffect(() => clearTimers, []);

  if (state === "idle") return null;

  return (
    <div
      // Not a live region and not announced: a screen reader already gets the
      // new page. This is for the eyes that are watching an unchanged screen.
      aria-hidden
      // overflow-hidden clips the segment at both edges, so it enters and
      // leaves cleanly instead of widening the page.
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
    >
      <div
        className={cn(
          // A SEGMENT, two fifths of the width, with both ends faded out by the
          // gradient — no hard edge anywhere, which is most of what makes it
          // read as smooth rather than as a moving block.
          "h-full w-2/5 bg-gradient-to-r from-transparent via-accent to-transparent",
          state === "done"
            ? // It does not snap to full — there is nothing to fill. It simply
              // stops being there, which is the quiet version of "done".
              "opacity-0 transition-opacity duration-300"
            : // Loops for as long as the wait lasts. ease-in-out so it arrives
              // and leaves softly instead of tearing across at a constant clip.
              "opacity-70 animate-[route-progress_800ms_cubic-bezier(0.4,0,0.2,1)_infinite] " +
              // Reduced motion: no travel. A still, very faint full-width line
              // that says something is happening without moving.
              "motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40",
        )}
      />
    </div>
  );
}
