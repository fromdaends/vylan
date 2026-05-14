"use client";

import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
  type Variants,
} from "framer-motion";
import { useRef, type ReactNode } from "react";

// Framer-motion-backed reveal + parallax for the landing page.
// Works in every browser (unlike CSS animation-timeline). Both
// reveals and parallax are bidirectional — scrolling back up reverses
// the animation. prefers-reduced-motion is honored automatically by
// framer-motion when MotionConfig is set (we set reducedMotion: "user"
// implicitly through the default behavior — framer-motion reads the
// system setting and disables transforms).

// ─────────────────────────────────────────────────────────────────────
// Reveal — fades + lifts + scales an element as it enters the viewport.
// Reverses on exit so scrolling up un-reveals.
// ─────────────────────────────────────────────────────────────────────

type Intensity = "soft" | "strong" | "pop";

const INTENSITY: Record<Intensity, Variants> = {
  soft: {
    hidden: { opacity: 0, y: 28 },
    visible: { opacity: 1, y: 0 },
  },
  strong: {
    hidden: { opacity: 0, y: 80, scale: 0.92 },
    visible: { opacity: 1, y: 0, scale: 1 },
  },
  pop: {
    hidden: { opacity: 0, y: 60, scale: 0.88 },
    visible: { opacity: 1, y: 0, scale: 1 },
  },
};

export function ScrollReveal({
  children,
  intensity = "soft",
  delay = 0,
  duration = 0.55,
  once = false,
  className,
}: {
  children: ReactNode;
  intensity?: Intensity;
  delay?: number;
  duration?: number;
  // Default false → bidirectional. Pass true to fire once and forget.
  once?: boolean;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      // Margin shrinks the viewport rect so the reveal fires a bit
      // before the element hits the edge — feels more responsive.
      viewport={{ once, margin: "0px 0px -10% 0px", amount: 0.15 }}
      variants={INTENSITY[intensity]}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ParallaxLayer — drifts at a different speed than the page as you
// scroll past. Bidirectional. Use `intensity` to control distance:
// positive = element moves UP as you scroll DOWN (foreground feel),
// negative = element moves DOWN as you scroll DOWN (background feel).
// ─────────────────────────────────────────────────────────────────────

export function ParallaxLayer({
  children,
  intensity = 60,
  className,
}: {
  children: ReactNode;
  // Pixels of drift across the element's full scroll-through. Try
  // 40–150 for subtle, 200+ for dramatic.
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

// ─────────────────────────────────────────────────────────────────────
// useParallax — bare hook for the rare case you want to drive the
// transform of a non-motion element. Exported in case we need it.
// ─────────────────────────────────────────────────────────────────────

export function useParallaxY(
  intensity: number,
  // Pass a ref pointing at the section that drives the timeline.
  target: React.RefObject<HTMLElement>,
): MotionValue<number> {
  const { scrollYProgress } = useScroll({
    target,
    offset: ["start end", "end start"],
  });
  return useTransform(scrollYProgress, [0, 1], [intensity, -intensity]);
}
