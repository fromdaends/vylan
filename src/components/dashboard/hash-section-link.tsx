"use client";

import type { ReactNode } from "react";

// Custom event used by CollapsibleSection to re-fire its highlight
// pulse on every click of a tile, even when the URL hash is already
// at the target (in which case the browser emits no hashchange).
export const HIGHLIGHT_EVENT = "collapsible-highlight";

export type HighlightDetail = { id: string };

// Tile/link that drives a CollapsibleSection by id. Renders as a
// normal `<a href="#X">` (so back-button / middle-click / a11y all
// work) AND dispatches HIGHLIGHT_EVENT on every click so the
// destination pulses again on repeat clicks. Also calls
// scrollIntoView so the section is brought back into view if the
// user has scrolled away from it.
export function HashSectionLink({
  hash,
  className,
  children,
}: {
  hash: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`#${hash}`}
      className={className}
      onClick={() => {
        if (typeof window === "undefined") return;
        requestAnimationFrame(() => {
          document
            .getElementById(hash)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
          window.dispatchEvent(
            new CustomEvent<HighlightDetail>(HIGHLIGHT_EVENT, {
              detail: { id: hash },
            }),
          );
        });
      }}
    >
      {children}
    </a>
  );
}
