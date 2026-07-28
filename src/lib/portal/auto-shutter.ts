// Bookkeeping for the self-firing shutter and the outline's on-screen
// persistence. Pure so it can be tested properly: the scanning loop it drives
// lives inside a requestAnimationFrame callback reading a canvas, and neither
// runs under the test DOM (no canvas) nor reliably in a headless browser (a
// hidden page has rAF paused entirely).
//
// THE SHUTTER FIRES ON SUSTAINED DETECTION AND NOTHING ELSE.
//
// Earlier versions also gated firing on light, motion, focus and fill, judged
// against thresholds that proved untunable from a desk: three rounds on a real
// phone ended with the founder's "I shouldn't have to have the hands of a
// surgeon" — which is the requirement, verbatim. So if the scanner can SEE a
// document, and has kept seeing it for long enough to rule out a swing-past,
// it shoots. Shake included. A slightly soft capture is recoverable — the
// review screen offers Retake and the server-side AI rejects genuinely
// unusable files with a reason — whereas a shutter that never fires is not.
// The quality metrics still exist, but only as on-screen ADVICE.
//
// Measured in MILLISECONDS, not frames: counting frames coupled the shutter to
// the loop's speed, so tuning one silently retuned the other.

import { type Guidance } from "./frame-metrics";

export type ShutterState = {
  /** Milliseconds of accumulated detection credit. */
  detectedMs: number;
  /** Milliseconds since a document was last seen. */
  missMs: number;
};

export const INITIAL_SHUTTER: ShutterState = { detectedMs: 0, missMs: 0 };

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
   * during the grace window so the hint text doesn't flicker between "Looks
   * good" and "Point at your document" on a single dropped frame.
   */
  documentPresent: boolean;
  /** The guidance to show for this frame — ADVICE only, it gates nothing. */
  guidance: Guidance;
  /** 0..1, for a progress ring or a debug readout. */
  progress: number;
  /** Fire the shutter now. */
  fire: boolean;
};

export function advanceShutter(
  prev: ShutterState,
  input: {
    /** Did this frame actually yield a document quad? */
    detected: boolean;
    /**
     * Produces the guidance for this frame. Taken as a function because
     * whether a document counts as "present" depends on the grace window this
     * reducer owns. The result is shown to the client; it does NOT gate the
     * shutter.
     */
    guidanceFor: (documentPresent: boolean) => Guidance;
    /** Real time since the previous analysed frame. */
    elapsedMs: number;
    /** How long the outline (and the credit) survives a detection dropout. */
    graceMs: number;
    /** Accumulated detection time before the shutter fires. */
    requiredDetectedMs: number;
  },
): ShutterStep {
  const { detected, guidanceFor, graceMs, requiredDetectedMs } = input;
  // A hidden tab, a stalled decode or a debugger pause can hand us a gap of
  // several seconds; crediting all of it would fire on a frame nobody was
  // looking at. Treat a long gap as one ordinary step.
  const elapsed =
    Number.isFinite(input.elapsedMs) && input.elapsedMs > 0
      ? Math.min(input.elapsedMs, 250)
      : 0;

  const required = requiredDetectedMs > 0 ? requiredDetectedMs : Infinity;

  if (detected) {
    const detectedMs = prev.detectedMs + elapsed;
    const fire = detectedMs >= required;
    return {
      // Firing spends the credit: without this the next frame fires again
      // immediately and the client gets a burst of near-identical photos,
      // each its own upload and its own AI check.
      state: { detectedMs: fire ? 0 : detectedMs, missMs: 0 },
      outline: "update",
      documentPresent: true,
      guidance: guidanceFor(true),
      progress: fire ? 1 : clamp01(detectedMs / required),
      fire,
    };
  }

  const missMs = prev.missMs + elapsed;
  const withinGrace = missMs <= graceMs;
  // Within the grace window the credit HOLDS rather than draining. Shake blurs
  // the frame, blur drops detection for a few frames, and draining on every
  // dropout is precisely what made a shaky hand unable to fire — the founder's
  // complaint. Past the window the document is genuinely gone: start over.
  const detectedMs = withinGrace ? prev.detectedMs : 0;
  return {
    state: { detectedMs, missMs },
    outline: withinGrace ? "hold" : "clear",
    documentPresent: withinGrace,
    guidance: guidanceFor(withinGrace),
    progress: clamp01(detectedMs / required),
    fire: false,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
