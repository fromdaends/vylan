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
// ScrollReveal — direction-aware four-state machine:
//
//   1. Before first entry (initial mount, element below fold)
//      → snap to initial hidden state. No mount-time animation.
//
//   2. Entry while scrolling DOWN
//      → fade + lift + scale in over `duration`s.
//
//   3. Entry while scrolling UP (user is scrolling back over an
//      element they've already seen, re-entering from the TOP)
//      → snap to visible, no animation. They've seen it.
//
//   4. Exit while scrolling DOWN (element leaves via the TOP)
//      → blur fade-out over 0.4s. Reads as the element "drifting
//      out of focus" as you scroll past it.
//
//   5. Exit while scrolling UP (element leaves via the BOTTOM)
//      → snap to the ready-to-enter hidden state, no animation. This
//      resets the element so the NEXT DOWN-entry animates cleanly
//      from its full hidden start position.
//
// Perf:
//   - One shared window scroll listener for the whole page
//     (refcounted at module scope), not one per ScrollReveal.
//   - useInView uses IntersectionObserver (cheap, browser-native).
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

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;
// Exit values tuned for a dramatic, obvious "drift away" effect:
// slower duration + heavy blur + slight scale-down + small upward
// translate so the element doesn't just fade, it visibly LEAVES.
const EXIT_DURATION = 0.8;
const EXIT_BLUR_PX = 28;
const EXIT_SCALE = 0.9;
const EXIT_Y = -24;

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
  // margin is `top right bottom left`. Shrinking the effective
  // viewport by 20% from the top + 10% from the bottom means:
  //   - Entries fire when the element is meaningfully visible
  //     (10% bottom buffer keeps them from firing at the very edge).
  //   - Exits fire while the element is still 20% from the actual
  //     top of viewport — leaving roughly ~150px of visible screen
  //     real estate for the blur-fade exit animation to play in.
  //     Without this, inView only flipped false once the element was
  //     already mostly off-screen, so the exit animation ran where
  //     the user couldn't see it.
  const inView = useInView(ref, {
    // amount 0.25 = exits fire when only 25% of element remains in
    //   the effective viewport (vs 15%) — flips earlier so the exit
    //   animation has more visible runway.
    // margin "-30% 0px -10% 0px" — effective viewport top sits 30%
    //   below actual top. Exits trigger with ~30% of viewport height
    //   of visible screen remaining for the drift-away to play in.
    amount: 0.25,
    margin: "-30% 0px -10% 0px",
  });

  useEffect(() => attachSharedScrollListener(), []);

  // Tracks whether the element has ever entered the viewport. Used to
  // suppress the blur-exit animation on first mount: before first
  // entry, an "exit" state is just "pre-entry" and shouldn't animate.
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
          ? // — VISIBLE — entry, with animation only when DOWN
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
            ? // — PRE-ENTRY — initial hidden, no animation
              {
                opacity: 0,
                y: offsets.y,
                scale: offsets.scale,
                filter: "blur(0px)",
                transition: { duration: 0 },
              }
            : _scrollDownRef.current
              ? // — DOWN-EXIT — dramatic drift-away as the element
                //   leaves via the top of the viewport: fade to 0,
                //   blur out, shrink slightly, and translate up a
                //   touch. The combined effect reads as the section
                //   moving "into the distance" rather than just
                //   vanishing.
                {
                  opacity: 0,
                  y: EXIT_Y,
                  scale: EXIT_SCALE,
                  filter: `blur(${EXIT_BLUR_PX}px)`,
                  transition: { duration: EXIT_DURATION, ease: EASE_IN },
                }
              : // — UP-EXIT — element left via the bottom while
                //   scrolling up. Snap to the ready-to-enter state so
                //   the next DOWN-entry animates from a clean start.
                {
                  opacity: 0,
                  y: offsets.y,
                  scale: offsets.scale,
                  filter: "blur(0px)",
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
