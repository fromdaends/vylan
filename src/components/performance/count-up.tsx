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

  useEffect(() => {
    if (reduce) return; // reduced motion: value is rendered directly below
    const controls = animate(currentRef.current, value, {
      duration: durationMs / 1000,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => {
        currentRef.current = v;
        setAnimated(v);
      },
    });
    return () => controls.stop();
  }, [value, durationMs, reduce]);

  const display = reduce ? value : animated;

  return (
    <span className={className} aria-label={format(value)}>
      <span aria-hidden="true">{format(display)}</span>
    </span>
  );
}
