// Bookkeeping for the self-firing shutter and the outline's on-screen
// persistence. Pure so it can be tested properly: the scanning loop it drives
// lives inside a requestAnimationFrame callback reading a canvas, and neither
// runs under the test DOM (no canvas) nor reliably in a headless browser (a
// hidden page has rAF paused entirely).
//
// THE SHUTTER FIRES ON SUSTAINED DETECTION AND NOTHING ELSE.
//
// A "held the camera still for N seconds" fallback lived here briefly, added
// when the detector was failing and a client could be left holding a phone
// that did nothing. It photographed a blank wall, which is worse than doing
// nothing — a timer cannot tell a document from a wall, only the detector can.
// Removed on the founder's call: "it shouldn't be a timer. It should still
// detect a photo, and once the photo is in frame, then it goes off."
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
  /** 0..1 — drives the ring around the shutter button. */
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
    /** How long the OUTLINE (and the hint) survives a detection dropout. */
    graceMs: number;
    /**
     * How long the accumulated CREDIT survives one. Deliberately much longer
     * than graceMs: on a real phone the detector flickers — found, lost for
     * half a second, found again — with the document in frame the whole time.
     * When credit died with the outline, every flicker restarted the count
     * and a capture that should take a second took seventeen. The border may
     * blink; the client's progress must not.
     */
    creditHoldMs: number;
    /** Accumulated detection time before the shutter fires. */
    requiredDetectedMs: number;
  },
): ShutterStep {
  const { detected, guidanceFor, graceMs, requiredDetectedMs } = input;
  // Credit must never die before the outline does.
  const creditHoldMs = Math.max(
    graceMs,
    Number.isFinite(input.creditHoldMs) ? input.creditHoldMs : graceMs,
  );
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
      state: {
        detectedMs: fire ? 0 : detectedMs,
        missMs: 0,
      },
      outline: "update",
      documentPresent: true,
      guidance: guidanceFor(true),
      progress: fire ? 1 : clamp01(detectedMs / required),
      fire,
    };
  }

  const missMs = prev.missMs + elapsed;
  const withinGrace = missMs <= graceMs;
  // The credit HOLDS through a dropout (it neither drains nor accrues) and is
  // only forfeited once the document has been gone long enough that this is
  // plainly a different attempt, not a flicker.
  const detectedMs = missMs <= creditHoldMs ? prev.detectedMs : 0;
  return {
    state: { detectedMs, missMs },
    outline: withinGrace ? "hold" : "clear",
    documentPresent: withinGrace,
    guidance: guidanceFor(withinGrace),
    // No document, no progress. The ring sitting at empty while the camera
    // points at a wall is the honest reading — and it is what tells the
    // client to aim at their document rather than wait.
    progress: clamp01(detectedMs / required),
    fire: false,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
