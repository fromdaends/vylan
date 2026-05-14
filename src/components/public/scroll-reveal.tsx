"use client";

import {
  motion,
  useInView,
  useScroll,
  useTransform,
  type MotionValue,
  type Variants,
} from "framer-motion";
import { useRef, type ReactNode } from "react";

// Reveal + parallax for the landing page, framer-motion-backed.
//
// ScrollReveal behavior:
//   - Element enters viewport (scrolling DOWN) → fades + lifts in with
//     an animation.
//   - Element exits viewport (scrolling UP past it, or scrolling DOWN
//     past it) → instantly snaps back to the hidden state, no reverse
//     animation. Just disappears.
//   - Element re-enters viewport (scrolling DOWN again after going up)
//     → animation replays.
//
// This is what we want for a marketing page: the entrance is the
// payoff, the exit shouldn't compete for attention.
//
// prefers-reduced-motion is honored automatically by framer-motion via
// its global reduced-motion handling.

type Intensity = "soft" | "strong" | "pop";

// Each variant carries its own transition. Hidden has duration: 0 so
// the snap-back when leaving the viewport is instant rather than a
// reverse animation.
const VARIANTS: Record<Intensity, Variants> = {
  soft: {
    hidden: {
      opacity: 0,
      y: 28,
      transition: { duration: 0 },
    },
    visible: (custom: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.55,
        delay: custom,
        ease: [0.16, 1, 0.3, 1],
      },
    }),
  },
  strong: {
    hidden: {
      opacity: 0,
      y: 80,
      scale: 0.92,
      transition: { duration: 0 },
    },
    visible: (custom: number = 0) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.7,
        delay: custom,
        ease: [0.16, 1, 0.3, 1],
      },
    }),
  },
  pop: {
    hidden: {
      opacity: 0,
      y: 60,
      scale: 0.88,
      transition: { duration: 0 },
    },
    visible: (custom: number = 0) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.6,
        delay: custom,
        ease: [0.16, 1, 0.3, 1],
      },
    }),
  },
};

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
  // amount: how much of the element must be in view to count as
  // "in view". 0.15 = 15% visible.
  const inView = useInView(ref, {
    amount: 0.15,
    margin: "0px 0px -10% 0px",
  });

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={VARIANTS[intensity]}
      custom={delay}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ParallaxLayer — drifts at a different speed than the page as you
// scroll past. Always bidirectional (this stays on-screen as part of
// the page composition, not as a one-shot entrance).
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
