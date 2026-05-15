"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Scroll-triggered reveal + mesh-blended aurora glow for the AI
// document checks card on the landing page.
//
// Direction-aware state machine:
//   - DOWN entry  → motion.div is REMOUNTED via a bumped `key`, so
//                   it starts at `initial` and animates to `visible`.
//                   This is the trick that makes the slide-from-right
//                   replay on every fresh DOWN entry — without the
//                   remount, framer-motion sees `animate=visible`
//                   already matching the current state and doesn't
//                   re-run the transition.
//   - UP entry    → no key bump, state stays at `visible` (snap).
//   - DOWN exit   → state stays at `visible`, no animation.
//   - UP exit     → 0.55 s blur-fade to a hidden exit state. Matches
//                   the page-wide blur-away pattern.
//
// Implementation notes:
//   - useInView's IntersectionObserver attaches once via useEffect,
//     so we put the `ref` on a STABLE outer <div>. Remounting the
//     motion.div via the inner `key` would orphan the IO otherwise.
//   - hasEverEntered prevents the up-exit animation from firing
//     before the element has ever been in view.

// --- Shared scroll-direction tracking ---------------------------------
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
// Used when `lateExit` is set. Longer fade duration paired with the
// generous INVIEW_OPTS_LATE below — the element drifts out slowly
// after the user has scrolled well past it.
const UP_EXIT_DURATION_LATE = 1.6;
const REDUCED_DURATION = 0.4;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;
const UP_EXIT_BLUR_PX = 8;
const INVIEW_OPTS = { amount: 0.3, margin: "0px 0px -10% 0px" } as const;
// `lateExit` variant. Extends the root rectangle 35% BELOW the
// viewport (positive bottom margin) and drops the threshold to 5%.
// Net effect: the element stays "in view" — and therefore in its
// `visible` state, not its up-exit state — even after the user has
// scrolled well past it. Triggers the up-exit fade much later, so
// the section feels like it lingers on the way back up.
const INVIEW_OPTS_LATE = { amount: 0.05, margin: "0px 0px 35% 0px" } as const;

// --- Card -------------------------------------------------------------

export function AiCardReveal({
  children,
  direction = "right",
  variant = "warning",
  lateExit = false,
}: {
  children: ReactNode;
  /** Entry-swoop direction. "right" = card slides in from the right
   *  (default, original behaviour). "left" = mirror, for the
   *  success-state sub-section below the original. */
  direction?: "right" | "left";
  /** Aurora glow palette. "warning" = original iris/purple/pink/cyan
   *  warm-cool mesh (used by the AI-rejection sub-section).
   *  "success" = emerald/forest/mint/teal mesh (used by the AI-
   *  approval sub-section). Maps to the `.variant-success` selector
   *  in globals.css which overrides each blob's background. */
  variant?: "warning" | "success";
  /** When true, uses a more lenient IntersectionObserver config
   *  (INVIEW_OPTS_LATE) and a longer up-exit duration so the
   *  element lingers in its `visible` state much longer when the
   *  user scrolls back up past it. Used by the green success
   *  sub-section per user request. */
  lateExit?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Two observers when `lateExit` is on:
  //   - inViewStrict (always INVIEW_OPTS) drives the entry-key bump,
  //     so the swoop fires when the user actually sees the section,
  //     not when the loose root rectangle (extended below the
  //     viewport) first intersects the element.
  //   - inViewLoose (INVIEW_OPTS_LATE when lateExit) drives the
  //     visible/up-exit state, so the element keeps its `visible`
  //     state much longer as the user scrolls back up past it.
  // When `lateExit` is off, both observers use the same options
  // and the behaviour is equivalent to the original single-observer
  // version.
  const inViewLoose = useInView(
    ref,
    lateExit ? INVIEW_OPTS_LATE : INVIEW_OPTS,
  );
  const inViewStrict = useInView(ref, INVIEW_OPTS);
  const reducedMotion = useReducedMotion();
  useEffect(() => attachSharedScrollListener(), []);

  const hasEverEntered = useRef(false);
  if (inViewLoose) hasEverEntered.current = true;

  // Bump on every fresh DOWN entry through the STRICT threshold —
  // forces the inner motion.div to remount from `initial`, which
  // guarantees the slide-from-edge plays every time the section
  // comes substantially into view from below.
  const [entryKey, setEntryKey] = useState(0);
  const wasInViewStrictRef = useRef(false);
  useEffect(() => {
    if (
      inViewStrict &&
      !wasInViewStrictRef.current &&
      _scrollDownRef.current
    ) {
      setEntryKey((k) => k + 1);
    }
    wasInViewStrictRef.current = inViewStrict;
  }, [inViewStrict]);

  const x0 = direction === "left" ? -60 : 60;

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, x: x0, scale: 0.95, filter: "blur(0px)", y: 0 };
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

  const target = inViewLoose
    ? visible
    : !hasEverEntered.current
      ? initial
      : _scrollDownRef.current
        ? visible
        : upExit;

  const upExitDuration = lateExit ? UP_EXIT_DURATION_LATE : UP_EXIT_DURATION;
  const transition = inViewLoose
    ? {
        duration: reducedMotion ? REDUCED_DURATION : ENTER_DURATION_CARD,
        ease: EASE_OUT,
      }
    : !hasEverEntered.current
      ? { duration: 0 }
      : _scrollDownRef.current
        ? { duration: 0 }
        : { duration: upExitDuration, ease: EASE_IN };

  const glowClass =
    variant === "success" ? "ai-card-glow variant-success" : "ai-card-glow";

  return (
    <div ref={ref}>
      <motion.div
        key={entryKey}
        className="relative"
        initial={initial}
        animate={target}
        transition={transition}
      >
        <div className={glowClass} aria-hidden>
          <div className="ai-card-glow-blob blob-iris" />
          <div className="ai-card-glow-blob blob-purple" />
          <div className="ai-card-glow-blob blob-pink" />
          <div className="ai-card-glow-blob blob-cyan" />
        </div>
        {children}
      </motion.div>
    </div>
  );
}

// --- Side text --------------------------------------------------------

export function AiSideReveal({
  children,
  lateExit = false,
}: {
  children: ReactNode;
  /** Same semantics as AiCardReveal's `lateExit`. When true, the
   *  side text lingers in its `visible` state much longer when the
   *  user scrolls back up past it. Used together with the matching
   *  prop on AiCardReveal so the whole sub-section exits as a unit. */
  lateExit?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Same two-observer split as AiCardReveal — see comment there.
  const inViewLoose = useInView(
    ref,
    lateExit ? INVIEW_OPTS_LATE : INVIEW_OPTS,
  );
  const inViewStrict = useInView(ref, INVIEW_OPTS);
  const reducedMotion = useReducedMotion();
  useEffect(() => attachSharedScrollListener(), []);

  const hasEverEntered = useRef(false);
  if (inViewLoose) hasEverEntered.current = true;

  const [entryKey, setEntryKey] = useState(0);
  const wasInViewStrictRef = useRef(false);
  useEffect(() => {
    if (
      inViewStrict &&
      !wasInViewStrictRef.current &&
      _scrollDownRef.current
    ) {
      setEntryKey((k) => k + 1);
    }
    wasInViewStrictRef.current = inViewStrict;
  }, [inViewStrict]);

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 24, filter: "blur(10px)" };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, filter: "blur(0px)" };
  const upExit = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 20, filter: `blur(${UP_EXIT_BLUR_PX}px)` };

  const target = inViewLoose
    ? visible
    : !hasEverEntered.current
      ? initial
      : _scrollDownRef.current
        ? visible
        : upExit;

  const upExitDuration = lateExit ? UP_EXIT_DURATION_LATE : UP_EXIT_DURATION;
  const transition = inViewLoose
    ? {
        duration: reducedMotion ? REDUCED_DURATION : ENTER_DURATION_SIDE,
        ease: EASE_OUT,
      }
    : !hasEverEntered.current
      ? { duration: 0 }
      : _scrollDownRef.current
        ? { duration: 0 }
        : { duration: upExitDuration, ease: EASE_IN };

  return (
    <div ref={ref}>
      <motion.div
        key={entryKey}
        initial={initial}
        animate={target}
        transition={transition}
      >
        {children}
      </motion.div>
    </div>
  );
}
