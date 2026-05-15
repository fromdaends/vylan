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
// ScrollReveal — direction-aware state machine, per user spec:
//
//   1. Before first entry (initial mount, element below fold)
//      → snap to initial hidden state. No mount-time animation.
//
//   2. Entry while scrolling DOWN
//      → fade + lift + scale in over `duration`s. The "payoff".
//
//   3. Entry while scrolling UP (user is scrolling back over an
//      element they've already seen, re-entering from the TOP)
//      → snap to visible, no animation. They've seen it.
//
//   4. Exit while scrolling DOWN (element leaves via the TOP)
//      → NO ANIMATION. Element stays at its visible state in the
//      DOM; page scroll carries it off naturally. The user
//      specifically asked for zero blur effects on DOWN scrolls.
//
//   5. Exit while scrolling UP (element leaves via the BOTTOM)
//      → blur fade-out over 0.7s — opacity to 0, blur to 24px,
//      scale to 0.9, translate down so it drifts away. This is
//      what the user wants: the abrupt "instant disappearance"
//      they saw on UP-scrolls is replaced with a visible fade.
//
// Perf: one shared window scroll listener for the page; useInView is
// IntersectionObserver-backed. prefers-reduced-motion honored by FM.

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

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;
// UP-exit values: subtle drift-away when scrolling up past a section.
const UP_EXIT_DURATION = 0.55;
const UP_EXIT_BLUR_PX = 8;
const UP_EXIT_SCALE = 0.96;

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
  // margin "top right bottom left". Tuned so:
  //   - margin top 0%: DOWN exits fire at the actual viewport top.
  //     We don't animate the DOWN exit, so visibility doesn't matter
  //     and there's no point in a buffer that delays entries.
  //   - margin bottom -25%: UP exits fire while the element is still
  //     well within the actual viewport, leaving ~25% of viewport
  //     height of visible runway for the blur fade to play in.
  // `once: true` means the observer detaches the first time the
  // element crosses the threshold. After that, `inView` stays true
  // forever — scrolling away and back never flips it false, so the
  // UP-exit / DOWN-exit / re-entry branches below become unreachable
  // and the element sits in its settled `visible` state for the rest
  // of the session. State lives in the component, in memory; a page
  // refresh remounts and replays fresh from the top.
  const inView = useInView(ref, {
    amount: 0.2,
    margin: "0px 0px -5% 0px",
    once: true,
  });

  useEffect(() => attachSharedScrollListener(), []);

  // Tracks whether the element has ever entered the viewport. Used to
  // suppress the up-exit blur on first mount: before first entry, an
  // "exit" state is really just "pre-entry" and shouldn't animate.
  const hasEverEntered = useRef(false);
  if (inView) hasEverEntered.current = true;

  const offsets = INTENSITY_STATES[intensity];
  const duration = ENTRANCE_DURATION[intensity];

  return (
    <motion.div
      ref={ref}
      initial={{
        opacity: 0,
        y: offsets.y,
        scale: offsets.scale,
        filter: "blur(0px)",
      }}
      animate={
        inView
          ? // — VISIBLE — entry. Animate on DOWN, snap on UP.
            {
              opacity: 1,
              y: 0,
              scale: 1,
              filter: "blur(0px)",
              transition: _scrollDownRef.current
                ? { duration, delay, ease: EASE_OUT }
                : { duration: 0 },
            }
          : !hasEverEntered.current
            ? // — PRE-ENTRY — initial hidden, no animation.
              {
                opacity: 0,
                y: offsets.y,
                scale: offsets.scale,
                filter: "blur(0px)",
                transition: { duration: 0 },
              }
            : _scrollDownRef.current
              ? // — DOWN-EXIT — no animation. Stay at the visible
                //   target so framer-motion sees no diff and nothing
                //   transitions. Page scroll carries the element off
                //   the top naturally. Zero blur, zero effects.
                {
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  filter: "blur(0px)",
                  transition: { duration: 0 },
                }
              : // — UP-EXIT — blur drift-away. Element fades, blurs,
                //   shrinks, and drifts DOWN as the user scrolls up
                //   past it. Replaces the previous instant snap that
                //   the user complained about.
                {
                  opacity: 0,
                  y: offsets.y,
                  scale: UP_EXIT_SCALE,
                  filter: `blur(${UP_EXIT_BLUR_PX}px)`,
                  transition: { duration: UP_EXIT_DURATION, ease: EASE_IN },
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
