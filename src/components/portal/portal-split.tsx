"use client";

// The portal's responsive frame around "documents on one side, the message
// thread on the other".
//
//  • Desktop (lg+): a two-pane app — the documents/hub column on the left, the
//    message thread docked on the right at a fixed one-third width. Documents
//    keep the dominant two-thirds (the client's main task); a third is a
//    comfortable, uncramped width for the conversation. Each pane scrolls on its
//    own so the composer never leaves the bottom of the thread.
//  • Mobile (<lg): there is no split. The thread opens as a full-screen overlay
//    that sits just below the sticky firm header, with its own Back button, so
//    texting fills the whole screen instead of a short box mid-page.
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
          a fixed one-third pane on desktop. */}
      <aside
        className={cn(
          "z-30 flex-col bg-background",
          // Mobile overlay.
          "fixed inset-x-0 bottom-0 top-16",
          messagesOpen ? "flex" : "hidden",
          // Desktop pane — fixed at one-third of the width.
          "lg:static lg:inset-auto lg:z-auto lg:flex lg:min-h-0 lg:w-1/3 lg:shrink-0 lg:border-l lg:border-border/60",
        )}
      >
        {mountPanel ? panel : null}
      </aside>
    </div>
  );
}
