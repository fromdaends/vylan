"use client";

import { motion, useReducedMotion } from "framer-motion";
import { type ReactNode } from "react";

// Premium scroll-triggered reveal + animated mesh-blended aurora
// glow for the AI document checks card on the landing page.
//
// Wraps the existing <AiMockCard /> (its content + copy stay
// untouched). Provides:
//   - Slide-in from the right with fade + subtle scale, 900 ms
//     ease-out via cubic-bezier(0.22, 1, 0.36, 1). Triggered once
//     by framer-motion's `useInView` (Intersection-Observer-backed)
//     when ~30% of the section is in view.
//   - Four sibling `.ai-card-glow-blob` divs (iris, purple, pink,
//     cyan) inside a `.ai-card-glow` container behind the card.
//     Each blob drifts independently on its own keyframe; the
//     container's filter:blur merges them into a smooth, aurora-
//     like mesh. No rotating element → no "cube" feel.
//
// prefers-reduced-motion:
//   - Wrapper drops the slide + scale (fade only).
//   - Glow blob drifts slow to 40s + reduced opacity in globals.css.

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
      <div className="ai-card-glow" aria-hidden>
        <div className="ai-card-glow-blob blob-iris" />
        <div className="ai-card-glow-blob blob-purple" />
        <div className="ai-card-glow-blob blob-pink" />
        <div className="ai-card-glow-blob blob-cyan" />
      </div>
      {children}
    </motion.div>
  );
}

// Distinct entrance for the LEFT side of the AI section
// (eyebrow + heading + body + bullets). Differentiator vs. the rest
// of the page's standard ScrollReveal fade-up: this one combines
// a longer 1.1s duration with a blur-clear effect so the text
// resolves into focus rather than just sliding in. Paired with the
// card's slide-in from the right, the whole section reads as a
// "lit-up" reveal vs. the calmer fade-ups elsewhere on the page.
export function AiSideReveal({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 24, filter: "blur(10px)" };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, filter: "blur(0px)" };

  return (
    <motion.div
      initial={initial}
      whileInView={visible}
      viewport={{ once: true, amount: 0.3, margin: "0px 0px -10% 0px" }}
      transition={{
        duration: reducedMotion ? 0.4 : 1.1,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
