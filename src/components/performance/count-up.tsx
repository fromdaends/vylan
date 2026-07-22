"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

// A number that counts up on mount and animates smoothly to new values when its
// target changes (e.g. when the range switches). Calm and one-shot: it eases to
// a stop, never loops or bounces. When the viewer prefers reduced motion it
// renders the value directly with no animation.
export function CountUp({
  value,
  format,
  durationMs = 600,
  className,
}: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [animated, setAnimated] = useState(0);
  // The live animated value, so a mid-animation range change eases from where it
  // is rather than snapping back to zero.
  const currentRef = useRef(0);

  // Always animate `animated` (duration 0 under reduced motion = an instant
  // snap). We deliberately do NOT branch the RENDERED value on `reduce`: that
  // hook returns null on the server and the real boolean on the client's first
  // render, so branching would hydrate-mismatch for reduced-motion visitors.
  // Both server and first client render show `animated` (0), then the effect
  // animates (or snaps) after mount.
  useEffect(() => {
    const controls = animate(currentRef.current, value, {
      duration: reduce ? 0 : durationMs / 1000,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => {
        currentRef.current = v;
        setAnimated(v);
      },
    });
    return () => controls.stop();
  }, [value, durationMs, reduce]);

  const display = animated;

  return (
    <span className={className} aria-label={format(value)}>
      <span aria-hidden="true">{format(display)}</span>
    </span>
  );
}
