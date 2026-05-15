"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef, type ReactNode } from "react";

// Scroll-triggered reveal + mesh-blended aurora glow for the AI
// document checks card on the landing page.
//
// Replay behaviour
//   The first version used `whileInView` with `once: true`, which
//   only fired the animation a single time per page load. Users
//   scrolling away and back saw nothing the second time.
//
//   Now: `useInView` drives the animate state directly.
//     - Element enters viewport → animate to visible over the
//       normal duration.
//     - Element leaves viewport → snap back to initial with
//       duration 0. The user is scrolling away at that moment, so
//       they never see the snap.
//     - Next entry replays the animation from initial → visible.
//   Re-entries from either direction replay; the snap-on-exit
//   prevents a visible "reverse" animation while the user is
//   scrolling past.

const ENTER_DURATION_CARD = 0.9;
const ENTER_DURATION_SIDE = 1.1;
const REDUCED_DURATION = 0.4;
const EASE = [0.22, 1, 0.36, 1] as const;
const INVIEW_OPTS = { amount: 0.3, margin: "0px 0px -10% 0px" } as const;

export function AiCardReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, INVIEW_OPTS);
  const reducedMotion = useReducedMotion();

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, x: 60, scale: 0.95 };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, x: 0, scale: 1 };
  const enterDuration = reducedMotion ? REDUCED_DURATION : ENTER_DURATION_CARD;

  return (
    <motion.div
      ref={ref}
      className="relative"
      initial={initial}
      animate={inView ? visible : initial}
      transition={{
        // Animate IN over the normal duration. Snap back to initial
        // with duration 0 when leaving — user's scrolling past so
        // the snap is invisible, but it resets the element so the
        // next entry replays cleanly.
        duration: inView ? enterDuration : 0,
        ease: EASE,
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
// of the page: 1.1s blur-clear + small lift, paired with the card's
// slide-from-right. Same enter-on-view / snap-on-exit replay
// behaviour as AiCardReveal.
export function AiSideReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, INVIEW_OPTS);
  const reducedMotion = useReducedMotion();

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 24, filter: "blur(10px)" };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, filter: "blur(0px)" };
  const enterDuration = reducedMotion ? REDUCED_DURATION : ENTER_DURATION_SIDE;

  return (
    <motion.div
      ref={ref}
      initial={initial}
      animate={inView ? visible : initial}
      transition={{
        duration: inView ? enterDuration : 0,
        ease: EASE,
      }}
    >
      {children}
    </motion.div>
  );
}
