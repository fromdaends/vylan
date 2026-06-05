"use client";

import { useEffect, useRef, useState } from "react";

// Tiny IntersectionObserver hook so each card only fetches/renders its
// thumbnail once it scrolls near the viewport — keeps a grid of 30+ documents
// from loading every full image (or spinning up every PDF render) at once.
// Latches to true on first intersection and stops observing (thumbnails never
// need to unload).
export function useInView<T extends Element>(
  rootMargin = "300px",
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  // When IntersectionObserver isn't available (very old browsers), start
  // in-view so thumbnails still load — keeps the synchronous fallback out of
  // the effect body (react-hooks/set-state-in-effect).
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView];
}
