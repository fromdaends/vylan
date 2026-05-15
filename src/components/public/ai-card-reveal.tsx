"use client";

import { motion, useReducedMotion } from "framer-motion";
import { type ReactNode } from "react";

// Premium scroll-triggered reveal + animated multi-colour glow for
// the AI document checks card on the landing page.
//
// Wraps the existing <AiMockCard /> (its content + copy stay
// untouched). Provides:
//   - Slide-in from the right with fade + subtle scale, 900 ms
//     ease-out via cubic-bezier(0.22, 1, 0.36, 1). Triggered once
//     by framer-motion's `useInView` (Intersection-Observer-backed)
//     when ~30% of the section is in view.
//   - A sibling `.ai-card-glow` div positioned behind the card.
//     A conic-gradient that cycles blue → purple → pink → cyan →
//     blue rotates on a 10s linear loop; a 56 px blur softens the
//     hard colour stops into a smooth aurora. Glow opacity is
//     parented by the motion.div so it fades in alongside the slide.
//
// prefers-reduced-motion:
//   - Wrapper drops the slide + scale (fade only, faster duration).
//   - The conic-gradient cycle slows to 40s + reduced opacity via
//     a media query in globals.css.

export function AiCardReveal({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, x: 60, scale: 0.95 };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, x: 0, scale: 1 };

  return (
    <motion.div
      className="relative"
      initial={initial}
      whileInView={visible}
      viewport={{ once: true, amount: 0.3, margin: "0px 0px -10% 0px" }}
      transition={{
        duration: reducedMotion ? 0.4 : 0.9,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div className="ai-card-glow" aria-hidden />
      {children}
    </motion.div>
  );
}
