"use client";

import {
  motion,
  useInView,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

// Reveal + parallax for the landing page, framer-motion-backed.
//
// ScrollReveal behavior — direction-aware:
//   - Element enters viewport while page scroll is moving DOWN
//     → fades + lifts in over 0.7s.
//   - Element enters viewport while page scroll is moving UP (i.e.,
//     user has already seen it and is now scrolling back over it from
//     above) → snaps straight to visible with no animation.
//   - Element exits viewport in either direction → snaps to hidden
//     state silently. No reverse animation.
//   - Result: the entrance animation is a "scroll down" payoff; the
//     element never animates while you're going back up.
//
// prefers-reduced-motion is honored automatically by framer-motion.

type Intensity = "soft" | "strong" | "pop";

// y + scale offsets per intensity. Hidden = the start of the entrance
// animation, visible = the rest state.
const INTENSITY_STATES: Record<Intensity, { y: number; scale: number }> = {
  soft: { y: 28, scale: 1 },
  strong: { y: 80, scale: 0.92 },
  pop: { y: 60, scale: 0.88 },
};

const ENTRANCE_DURATION: Record<Intensity, number> = {
  soft: 0.55,
  strong: 0.7,
  pop: 0.6,
};

const EASE = [0.16, 1, 0.3, 1] as const;

export function ScrollReveal({
  children,
  intensity = "soft",
  delay = 0,
  className,
}: {
  children: ReactNode;
  intensity?: Intensity;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, {
    amount: 0.15,
    margin: "0px 0px -10% 0px",
  });

  // Track scroll direction in a ref so we can branch the variant
  // transition at the exact moment animation kicks off — without
  // causing extra re-renders on every scroll event.
  const lastScrollY = useRef(
    typeof window !== "undefined" ? window.scrollY : 0,
  );
  const isScrollingDown = useRef(true);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      // ">=" so the very first scroll counts as DOWN even if delta is 0.
      isScrollingDown.current = y >= lastScrollY.current;
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const offsets = INTENSITY_STATES[intensity];
  const duration = ENTRANCE_DURATION[intensity];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: offsets.y, scale: offsets.scale }}
      animate={
        inView
          ? {
              opacity: 1,
              y: 0,
              scale: 1,
              // Only animate when entering during a DOWN scroll.
              // Re-entering during an UP scroll snaps to visible
              // (duration 0) so nothing happens while going up.
              transition: isScrollingDown.current
                ? { duration, delay, ease: EASE }
                : { duration: 0 },
            }
          : {
              opacity: 0,
              y: offsets.y,
              scale: offsets.scale,
              transition: { duration: 0 },
            }
      }
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ParallaxLayer — drifts at a different speed than the page as you
// scroll past. Bidirectional by design (it's part of the page
// composition, not a one-shot entrance).
// ─────────────────────────────────────────────────────────────────────

export function ParallaxLayer({
  children,
  intensity = 60,
  className,
}: {
  children: ReactNode;
  intensity?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [intensity, -intensity]);

  return (
    <motion.div ref={ref} style={{ y }} className={className}>
      {children}
    </motion.div>
  );
}

export function useParallaxY(
  intensity: number,
  target: React.RefObject<HTMLElement>,
): MotionValue<number> {
  const { scrollYProgress } = useScroll({
    target,
    offset: ["start end", "end start"],
  });
  return useTransform(scrollYProgress, [0, 1], [intensity, -intensity]);
}
