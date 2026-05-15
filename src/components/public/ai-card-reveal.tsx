"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

// Scroll-triggered reveal + mesh-blended aurora glow for the AI
// document checks card on the landing page.
//
// Direction-aware state machine — matches the page-wide pattern used
// by <ScrollReveal>:
//   - DOWN entry  → animate to visible (slide-from-right card,
//                   blur-clear side text)
//   - UP entry    → snap to visible (user has already seen it)
//   - DOWN exit   → stay at visible, no animation (user is scrolling
//                   past, not watching)
//   - UP exit     → 0.55s blur-fade to a hidden exit state, mirrors
//                   the rest of the page's "blur away on scroll-up"
//                   behaviour. This is the bit that was previously
//                   snapping with `duration: 0` and looking like an
//                   instant disappearance.
//
// First-mount safety: a `hasEverEntered` ref prevents the exit
// animation from firing before the element has ever been in view.

// --- Shared scroll-direction tracking ---------------------------------
// One window scroll listener for everything that imports from here.
// Refcounted on mount/unmount so it tears down cleanly. Module-scoped
// state means the latest direction is always available synchronously
// when framer-motion reads the animate prop.
let _lastScrollY = typeof window !== "undefined" ? window.scrollY : 0;
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

// --- Tuning -----------------------------------------------------------
const ENTER_DURATION_CARD = 0.9;
const ENTER_DURATION_SIDE = 1.1;
const UP_EXIT_DURATION = 0.55;
const REDUCED_DURATION = 0.4;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;
const UP_EXIT_BLUR_PX = 8;
const INVIEW_OPTS = { amount: 0.3, margin: "0px 0px -10% 0px" } as const;

// --- Card -------------------------------------------------------------

export function AiCardReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, INVIEW_OPTS);
  const reducedMotion = useReducedMotion();
  useEffect(() => attachSharedScrollListener(), []);

  const hasEverEntered = useRef(false);
  if (inView) hasEverEntered.current = true;

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, x: 60, scale: 0.95, filter: "blur(0px)", y: 0 };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, x: 0, scale: 1, filter: "blur(0px)", y: 0 };
  const upExit = reducedMotion
    ? { opacity: 0 }
    : {
        opacity: 0,
        x: 0,
        scale: 0.96,
        y: 20,
        filter: `blur(${UP_EXIT_BLUR_PX}px)`,
      };

  // Pick the target state based on inView + scroll direction.
  const target = inView
    ? visible
    : !hasEverEntered.current
      ? initial
      : _scrollDownRef.current
        ? visible // scrolling down past — stay (no visible change)
        : upExit; // scrolling up past — blur fade away

  // Pick the matching transition.
  const transition = inView
    ? {
        duration: reducedMotion ? REDUCED_DURATION : ENTER_DURATION_CARD,
        ease: EASE_OUT,
      }
    : !hasEverEntered.current
      ? { duration: 0 }
      : _scrollDownRef.current
        ? { duration: 0 }
        : { duration: UP_EXIT_DURATION, ease: EASE_IN };

  return (
    <motion.div
      ref={ref}
      className="relative"
      initial={initial}
      animate={target}
      transition={transition}
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

// --- Side text --------------------------------------------------------
// Distinct from the rest of the page: blur-clear + lift over 1.1s on
// DOWN entry, blur-fade away on UP exit (matches the page's
// scroll-up-exit pattern). Snap on UP-entry and DOWN-exit just like
// AiCardReveal above.

export function AiSideReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, INVIEW_OPTS);
  const reducedMotion = useReducedMotion();
  useEffect(() => attachSharedScrollListener(), []);

  const hasEverEntered = useRef(false);
  if (inView) hasEverEntered.current = true;

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 24, filter: "blur(10px)" };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, filter: "blur(0px)" };
  const upExit = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 20, filter: `blur(${UP_EXIT_BLUR_PX}px)` };

  const target = inView
    ? visible
    : !hasEverEntered.current
      ? initial
      : _scrollDownRef.current
        ? visible
        : upExit;

  const transition = inView
    ? {
        duration: reducedMotion ? REDUCED_DURATION : ENTER_DURATION_SIDE,
        ease: EASE_OUT,
      }
    : !hasEverEntered.current
      ? { duration: 0 }
      : _scrollDownRef.current
        ? { duration: 0 }
        : { duration: UP_EXIT_DURATION, ease: EASE_IN };

  return (
    <motion.div
      ref={ref}
      initial={initial}
      animate={target}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}
