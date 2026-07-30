"use client";

// The portal's responsive frame around "documents on one side, the message
// thread on the other".
//
//  • Desktop (lg+): a two-pane app — the documents/hub column on the left, the
//    message thread on the right as a FLOATING BUBBLE: an inset, rounded, shadowed
//    card rather than a flush docked panel, so the conversation reads as a chat
//    window resting on the page (the design's treatment). Each pane scrolls on
//    its own so the composer never leaves the bottom of the thread.
//  • Mobile (<lg): there is no split, and no bubble — margins and rounded corners
//    would waste scarce width. The thread opens as a full-screen overlay just
//    below the sticky firm header, with its own Back button, so texting fills the
//    whole screen instead of a short box mid-page.
//
// When the engagement has no messaging (not enabled, or complete with no
// history) this renders the documents column exactly as the long-standing
// single-column portal did: one centred column, the page scrolls normally.

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PortalSplit({
  enabled,
  messagesOpen,
  panel,
  children,
}: {
  // Whether this engagement has a message thread at all.
  enabled: boolean;
  // Mobile overlay visibility (ignored by the desktop pane, which is permanent).
  messagesOpen: boolean;
  // The message thread element (e.g. <PortalMessages/>). Mounted only while
  // actually visible, so the thread's "mark read" only fires when the client
  // can genuinely see it (never silently on a hidden mobile page).
  panel: ReactNode;
  // The documents / hub column.
  children: ReactNode;
}) {
  const [isDesktop, setIsDesktop] = useState(false);

  // Track the lg breakpoint so the thread mounts on desktop (where the pane is
  // always visible) and, on mobile, only once the client opens it.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Lock the background from scrolling while the mobile overlay is open. Desktop
  // (where the pane is in-flow) is left untouched.
  useEffect(() => {
    if (!messagesOpen) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [messagesOpen]);

  // No messaging: the documents column stands alone, exactly as before.
  if (!enabled) return <>{children}</>;

  const mountPanel = isDesktop || messagesOpen;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Documents / hub — its own scroll region on desktop. */}
      <div className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">
        {children}
      </div>

      {/* Messages: a full-screen overlay on mobile (below the h-16 firm header),
          a floating rounded bubble on desktop. */}
      <aside
        aria-label="Messages"
        className={cn(
          "z-30 flex-col bg-background",
          // Mobile overlay — flush and full-bleed, no rounding or inset.
          "fixed inset-x-0 bottom-0 top-16",
          messagesOpen ? "flex" : "hidden",
          // Desktop bubble: inset from the edges, rounded, bordered and lifted
          // off the page. Wider than the old quarter-pane (the design's 480px)
          // while documents keep the dominant share, and capped so it can't eat
          // the checklist on smaller laptops.
          "lg:static lg:inset-auto lg:z-auto lg:flex lg:min-h-0 lg:w-[clamp(20rem,28vw,30rem)] lg:shrink-0",
          "lg:my-4 lg:mr-4 lg:overflow-hidden lg:rounded-3xl lg:border lg:border-border",
          "lg:shadow-[0_2px_4px_oklch(0.2_0.02_264_/_0.08),0_20px_48px_-16px_oklch(0.2_0.02_264_/_0.35)]",
        )}
      >
        {mountPanel ? panel : null}
      </aside>
    </div>
  );
}
