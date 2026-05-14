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
//     → fades + lifts in.
//   - Element enters viewport while page scroll is moving UP (i.e.,
//     user is scrolling back over it from above) → snaps to visible
//     with no animation.
//   - Element exits viewport in either direction → snaps to hidden
//     silently, so it can animate again on the next DOWN entry.
//
// Perf:
//   - One shared window scroll listener for the whole page, not one
//     per ScrollReveal instance. With ~15 instances on the landing,
//     the naive approach would call 15 callbacks per scroll event.
//   - useInView uses IntersectionObserver (cheap, browser-native).
//   - Direction is tracked in a module-level ref so listeners share
//     it without prop drilling or context.
//
// prefers-reduced-motion is honored automatically by framer-motion.

// ─── Shared scroll-direction tracking ────────────────────────────────

let _lastScrollY =
  typeof window !== "undefined" ? window.scrollY : 0;
const _scrollDownRef = { current: true };
let _listenerRefCount = 0;
let _scrollHandler: (() => void) | null = null;

function attachSharedScrollListener(): () => void {
  if (typeof window === "undefined") return () => {};
  _listenerRefCount += 1;
  if (_listenerRefCount === 1) {
    _scrollHandler = () => {
      const y = window.scrollY;
      _scrollDownRef.current = y >= _lastScrollY;
      _lastScrollY = y;
    };
    window.addEventListener("scroll", _scrollHandler, { passive: true });
  }
  return () => {
    _listenerRefCount -= 1;
    if (_listenerRefCount === 0 && _scrollHandler) {
      window.removeEventListener("scroll", _scrollHandler);
      _scrollHandler = null;
    }
  };
}

// ─── ScrollReveal ────────────────────────────────────────────────────

type Intensity = "soft" | "strong" | "pop";

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

  useEffect(() => attachSharedScrollListener(), []);

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
              transition: _scrollDownRef.current
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

// ─── ParallaxLayer ───────────────────────────────────────────────────
// Drifts at a different speed than the page as you scroll past.
// Bidirectional by design.

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
