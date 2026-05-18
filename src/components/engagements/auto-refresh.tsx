"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Polls router.refresh() on a fixed interval so new client uploads, AI
// verdicts, and activity-log entries appear without the accountant
// having to hit reload. router.refresh() patches the page in place —
// open modals / scroll position / focused inputs are preserved.
//
// Pauses while the tab is hidden so we don't burn server CPU and DB
// hits for a tab nobody is looking at. When the tab becomes visible
// again, we kick a refresh immediately so the user sees the latest
// state straight away.
//
// Default interval is 5s — generous enough that the engagement detail
// page only does ~12 fan-outs per minute per viewer, but tight enough
// that the AI verdict (which lands ~3–15s after the client uploads)
// surfaces visibly fast.
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      router.refresh();
    };

    const id = setInterval(refresh, intervalRef.current);

    // Fire immediately on tab-show. visibilitychange only fires on
    // state transitions, so this won't fire on initial mount.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
