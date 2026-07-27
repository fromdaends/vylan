// Bookkeeping for the self-firing shutter and the outline's on-screen
// persistence. Pure so it can be tested properly: the scanning loop it drives
// lives inside a requestAnimationFrame callback reading a canvas, and neither
// runs under the test DOM (no canvas) nor reliably in a headless browser (a
// hidden page has rAF paused entirely).

import { shouldAutoCapture, type Guidance } from "./frame-metrics";

export type ShutterState = {
  /** Consecutive analysed frames that were good enough to shoot. */
  readyStreak: number;
  /** Consecutive frames in which no document was found. */
  missStreak: number;
};

export const INITIAL_SHUTTER: ShutterState = { readyStreak: 0, missStreak: 0 };

/** What the caller should do with the outline this frame. */
export type OutlineAction =
  /** A document was found — draw the new quad. */
  | "update"
  /** Missed, but recently enough that the last quad should stay on screen. */
  | "hold"
  /** Missed for long enough — take the outline down. */
  | "clear";

export type ShutterStep = {
  state: ShutterState;
  outline: OutlineAction;
  /**
   * Whether a document was treated as present when guidance was computed. True
   * during the grace period so the hint text doesn't flicker between "Looks
   * good" and "Point at your document" on a single dropped frame.
   */
  documentPresent: boolean;
  /** The guidance to show for this frame. */
  guidance: Guidance;
  /** Fire the shutter now. */
  fire: boolean;
};

/**
 * Advance one analysed frame.
 *
 * The rule that matters: a miss ALWAYS resets the ready streak, even while the
 * outline is still being held on screen. The outline may coast over a dropped
 * frame because that only affects what is drawn; the shutter may not, because
 * that decides what gets photographed and uploaded.
 */
export function advanceShutter(
  prev: ShutterState,
  input: {
    /** Did this frame actually yield a document quad? */
    detected: boolean;
    /**
     * Produces the guidance for this frame. Taken as a function because
     * whether a document counts as "present" depends on the grace window this
     * reducer owns, and guidance in turn decides whether the shutter fires —
     * so the two have to be resolved together rather than by the caller.
     */
    guidanceFor: (documentPresent: boolean) => Guidance;
    /** How many consecutive misses the outline survives. */
    graceFrames: number;
    /** How many consecutive ready frames before the shutter fires. */
    requiredFrames: number;
  },
): ShutterStep {
  const { detected, guidanceFor, graceFrames, requiredFrames } = input;

  if (!detected) {
    const missStreak = prev.missStreak + 1;
    const documentPresent = missStreak <= graceFrames;
    return {
      state: { readyStreak: 0, missStreak },
      outline: documentPresent ? "hold" : "clear",
      documentPresent,
      guidance: guidanceFor(documentPresent),
      fire: false,
    };
  }

  const guidance = guidanceFor(true);
  const readyStreak = guidance === "ready" ? prev.readyStreak + 1 : 0;
  const fire = shouldAutoCapture(readyStreak, requiredFrames);
  return {
    // Firing consumes the streak: without this the next frame would fire
    // again immediately and the client would get a burst of near-identical
    // photos, each one its own upload and its own AI check.
    state: { readyStreak: fire ? 0 : readyStreak, missStreak: 0 },
    outline: "update",
    documentPresent: true,
    guidance,
    fire,
  };
}
