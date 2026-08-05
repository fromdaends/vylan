"use client";

// Does this person want movement? ONE hook, for everything that animates in JS.
//
// CSS gets this for free with `@media (prefers-reduced-motion: reduce)`, but a
// library that animates from JavaScript — recharts growing a bar from zero, a
// PDF viewer easing a page turn — never sees that media query and will happily
// move things for somebody who asked it not to.
//
// Extracted from document-viewer.tsx, which had the only copy. The Work
// overview's charts needed the same answer, and a second copy is exactly the
// drift the cohesion rule exists to stop.
//
// ⚠️ REDUCED MOTION MEANS NO MOVEMENT, NOT NO EFFECT. Callers should drop the
// travel and keep the colour, the fade and the glow — the marketing hero
// learned this the expensive way in #961, where a blanket reset left every
// reduced-motion visitor with a flat cut instead of a cross-dissolve.

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  // Lazy-init from the media query, then only update from the change event —
  // never synchronously inside the effect body, which trips
  // react-hooks/set-state-in-effect and re-renders twice on every mount.
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    // ⚠️ NO setReduced(mq.matches) HERE. The obvious "re-read on mount in case
    // the server guessed wrong" line is a lint error in this repo
    // (react-hooks/set-state-in-effect) and it is unnecessary: the lazy
    // initialiser above runs on the CLIENT during hydration, so a
    // reduced-motion visitor already has `true` on their first render. Only
    // later changes need the listener.
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return reduced;
}
