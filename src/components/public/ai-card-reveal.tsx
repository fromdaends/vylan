"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// useLayoutEffect inside a "use client" component still runs during
// SSR hydration setup on the server, which logs a warning. Fall back
// to useEffect on the server (where it does nothing anyway) and use
// useLayoutEffect on the client. This is the standard isomorphic
// pattern recommended by the React team.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
// Glow opacity fade-in. Matched to ENTER_DURATION_CARD so the
// ambient backlight lands at the same moment as the card swoop
// instead of trailing it — the previous 1.4s value left a visible
// ~0.5s tail of "section still settling" after the card was done,
// which read as a lag on re-entry. The underlying CSS blob drift
// keeps running continuously regardless of this duration, so the
// "fade-in over a continuously moving glow" property is preserved.
const GLOW_FADE_IN_DURATION = 0.9;
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
// How long the section must have been out of view before the
// next DOWN entry is allowed to replay the swoop. Set tight: only
// blocks ultra-fast involuntary flicks (sub-100ms). Any deliberate
// scroll-and-return — even a quick glance at the section above —
// takes longer than this and arms the replay. Earlier 300ms and
// 1000ms values were both too long for the user's natural revisit
// patterns.
const REPLAY_COOLDOWN_MS = 100;

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
  // `inView` (always INVIEW_OPTS, threshold 0.3) drives EVERYTHING
  // entry-related — the key bump and the primary `visible` state
  // when the element is substantially in viewport. This is the same
  // observer the rejection card uses, so the green card's swoop-in
  // fires at exactly the same scroll position with exactly the same
  // timing — identical symmetry.
  const inView = useInView(ref, INVIEW_OPTS);
  // `inViewLoose` is consulted ONLY to defer the up-exit. When the
  // user scrolls back up and `inView` flips false, the loose
  // observer's extended root (35% below viewport) means the element
  // is still "in" it for longer. In that window we hold target at
  // `visible` instead of triggering `upExit`. Once even the loose
  // observer flips false, the fade-out finally runs.
  // When `lateExit` is off, INVIEW_OPTS_LATE === INVIEW_OPTS so the
  // loose check collapses to the same as `inView` — no linger,
  // identical to the original single-observer flow.
  const inViewLoose = useInView(
    ref,
    lateExit ? INVIEW_OPTS_LATE : INVIEW_OPTS,
  );
  const reducedMotion = useReducedMotion();
  useEffect(() => attachSharedScrollListener(), []);

  const hasEverEntered = useRef(false);
  if (inView) hasEverEntered.current = true;

  // Bump on every fresh DOWN entry — forces the inner motion.div to
  // remount from `initial`, which guarantees the slide-from-edge
  // plays every time the section comes into view from below.
  //
  // useLayoutEffect (via the isomorphic shim above) runs
  // SYNCHRONOUSLY after render commits but BEFORE the browser
  // paints. Doing the key bump here ensures the remount-with-fresh-
  // initial-state happens in the same paint cycle as the inView=
  // true detection, so the user never sees a one-frame false-start
  // before the swoop.
  //
  // Wiggle guard via `lastExitTimeRef`: only replay the swoop if
  // the section has been out of view (inView=false) for longer
  // than REPLAY_COOLDOWN_MS. A fast wiggle (scroll up + back in
  // <1 s) doesn't replay; an intentional revisit (any scroll-away
  // that takes >1 s of wall-clock time) does. Time-based catches
  // the cases distance-based misses — the user can scroll a long
  // way fast OR a short way slowly, only the latter feels like a
  // revisit.
  const [entryKey, setEntryKey] = useState(0);
  const wasInViewRef = useRef(false);
  const lastExitTimeRef = useRef(0);
  useIsomorphicLayoutEffect(() => {
    if (!inView) {
      lastExitTimeRef.current = Date.now();
    }
  }, [inView]);
  useIsomorphicLayoutEffect(() => {
    const cooledDown =
      Date.now() - lastExitTimeRef.current > REPLAY_COOLDOWN_MS;
    if (
      inView &&
      !wasInViewRef.current &&
      _scrollDownRef.current &&
      cooledDown
    ) {
      setEntryKey((k) => k + 1);
    }
    wasInViewRef.current = inView;
  }, [inView]);

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

  // Whether enough wall-clock time has passed since the last exit
  // to allow a swoop replay. Read at render time so the target
  // ternary below uses the freshest value.
  const cooledDown =
    Date.now() - lastExitTimeRef.current > REPLAY_COOLDOWN_MS;

  // Target state.
  // The scroll-down branch distinguishes three sub-cases because
  // `inViewLoose=true` alone is ambiguous:
  //   (a) Approaching from below for a fresh swoop (cooldown
  //       elapsed + not just-exited). Snap target to `initial` so
  //       the swoop replays cleanly from off-screen.
  //   (b) Just exited via the TOP of the viewport, still grazing
  //       the loose root (wasInViewRef still true because the
  //       effect hasn't committed the new value yet). Stay at
  //       `visible`.
  //   (c) Wiggle-revisit before cooldown elapsed (user scrolled up
  //       and back down within <1 s). Stay at `visible` so when
  //       `inView` flips true again, motion is already at visible
  //       and no animation plays.
  //
  // Only (a) gets `initial`; (b) and (c) stay at `visible`. The
  // gating triple — `inViewLoose && !wasInViewRef && cooledDown` —
  // tells (a) apart from (b) and (c).
  //
  // The up-exit branch (scrolling UP) is unchanged.
  const target = inView
    ? visible
    : !hasEverEntered.current
      ? initial
      : _scrollDownRef.current
        ? inViewLoose && !wasInViewRef.current && cooledDown
          ? initial
          : visible
        : inViewLoose
          ? visible
          : upExit;

  const upExitDuration = lateExit ? UP_EXIT_DURATION_LATE : UP_EXIT_DURATION;
  // Transition — entry duration on entry, instant snap on scroll-
  // down branches (so the new `initial` target above doesn't animate
  // visibly when the element is below viewport), exit duration when
  // the up-fade actually triggers.
  const transition = inView
    ? {
        duration: reducedMotion ? REDUCED_DURATION : ENTER_DURATION_CARD,
        ease: EASE_OUT,
      }
    : !hasEverEntered.current
      ? { duration: 0 }
      : _scrollDownRef.current
        ? { duration: 0 }
        : inViewLoose
          ? { duration: 0 }
          : { duration: upExitDuration, ease: EASE_IN };

  const glowClass =
    variant === "success" ? "ai-card-glow variant-success" : "ai-card-glow";

  // Glow opacity tracks the same logic as the card target — same
  // gating triple in the scroll-down branch so glow only resets to
  // opacity:0 when the section is truly approaching from below for
  // a fresh swoop. On wiggle revisits (cooldown not elapsed) or
  // top-of-viewport exits (just-exited), glow stays at 1.
  //
  // CRITICALLY, the glow's motion.div is NOT key-bumped — it stays
  // mounted across re-entries, so the four blob CSS animations keep
  // drifting continuously from page load. That eliminates the
  // "static burst then suddenly starts moving" handoff: when the
  // section comes into view, the blobs are already mid-drift and
  // the opacity just eases up underneath the motion.
  const glowTarget = inView
    ? { opacity: 1 }
    : !hasEverEntered.current
      ? { opacity: 0 }
      : _scrollDownRef.current
        ? inViewLoose && !wasInViewRef.current && cooledDown
          ? { opacity: 0 }
          : { opacity: 1 }
        : inViewLoose
          ? { opacity: 1 }
          : { opacity: 0 };
  const glowTransition = inView
    ? { duration: GLOW_FADE_IN_DURATION, ease: EASE_OUT }
    : !hasEverEntered.current
      ? { duration: 0 }
      : _scrollDownRef.current
        ? { duration: 0 }
        : inViewLoose
          ? { duration: 0 }
          : { duration: upExitDuration, ease: EASE_IN };

  return (
    <div ref={ref} className="relative">
      {/* Ambient backlight — sibling of the card, not a child, so
          remounting the card on entry doesn't restart the blob CSS
          animations. */}
      <motion.div
        className={glowClass}
        aria-hidden
        initial={{ opacity: 0 }}
        animate={glowTarget}
        transition={glowTransition}
      >
        <div className="ai-card-glow-blob blob-iris" />
        <div className="ai-card-glow-blob blob-purple" />
        <div className="ai-card-glow-blob blob-pink" />
        <div className="ai-card-glow-blob blob-cyan" />
      </motion.div>
      <motion.div
        key={entryKey}
        className="relative"
        initial={initial}
        animate={target}
        transition={transition}
      >
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
  // Two-observer pattern (same as AiCardReveal):
  //   - inView      (strict)                    — entry path + visible state
  //   - inViewLoose (lateExit ? +35% : strict)  — defer up-exit
  // Replay arming is time-based (`lastExitTimeRef`), see AiCardReveal.
  const inView = useInView(ref, INVIEW_OPTS);
  const inViewLoose = useInView(
    ref,
    lateExit ? INVIEW_OPTS_LATE : INVIEW_OPTS,
  );
  const reducedMotion = useReducedMotion();
  useEffect(() => attachSharedScrollListener(), []);

  const hasEverEntered = useRef(false);
  if (inView) hasEverEntered.current = true;

  // Same time-based key-bump as AiCardReveal — see comment there.
  const [entryKey, setEntryKey] = useState(0);
  const wasInViewRef = useRef(false);
  const lastExitTimeRef = useRef(0);
  useIsomorphicLayoutEffect(() => {
    if (!inView) {
      lastExitTimeRef.current = Date.now();
    }
  }, [inView]);
  useIsomorphicLayoutEffect(() => {
    const cooledDown =
      Date.now() - lastExitTimeRef.current > REPLAY_COOLDOWN_MS;
    if (
      inView &&
      !wasInViewRef.current &&
      _scrollDownRef.current &&
      cooledDown
    ) {
      setEntryKey((k) => k + 1);
    }
    wasInViewRef.current = inView;
  }, [inView]);

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 24, filter: "blur(10px)" };
  const visible = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, filter: "blur(0px)" };
  const upExit = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 20, filter: `blur(${UP_EXIT_BLUR_PX}px)` };

  // Same triple-gated hold-initial logic as AiCardReveal — see
  // comment there. Only set target=initial when approaching from
  // below for a fresh swoop (cooldown elapsed + not just-exited).
  const cooledDown =
    Date.now() - lastExitTimeRef.current > REPLAY_COOLDOWN_MS;
  const target = inView
    ? visible
    : !hasEverEntered.current
      ? initial
      : _scrollDownRef.current
        ? inViewLoose && !wasInViewRef.current && cooledDown
          ? initial
          : visible
        : inViewLoose
          ? visible
          : upExit;

  const upExitDuration = lateExit ? UP_EXIT_DURATION_LATE : UP_EXIT_DURATION;
  const transition = inView
    ? {
        duration: reducedMotion ? REDUCED_DURATION : ENTER_DURATION_SIDE,
        ease: EASE_OUT,
      }
    : !hasEverEntered.current
      ? { duration: 0 }
      : _scrollDownRef.current
        ? { duration: 0 }
        : inViewLoose
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
