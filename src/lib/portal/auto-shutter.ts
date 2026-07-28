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
  /** Milliseconds of continuous gross movement, for the tolerance window. */
  movingMs: number;
  /**
   * Milliseconds the frame has been held steady, DETECTED OR NOT.
   *
   * The safety net. If the detector cannot find the client's document — white
   * paper on a pale table, a hand over one edge, a scene it simply loses — no
   * amount of shutter logic produces a photo, and the client is left holding a
   * phone that does nothing. After seven rounds of that, holding the camera
   * still is enough on its own: we take the frame uncropped rather than take
   * nothing.
   */
  steadyMs: number;
};

export const INITIAL_SHUTTER: ShutterState = {
  detectedMs: 0,
  missMs: 0,
  movingMs: 0,
  steadyMs: 0,
};

/** Which route reached the shutter — the caller crops only for "document". */
export type FireMode = "document" | "frame";

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
  /** Set when `fire` is true: whether a document was found to crop to. */
  fireMode: FireMode | null;
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
    /**
     * Is the frame free of GROSS movement — someone sweeping the phone across
     * the room, not someone holding it in their hand? The caller decides; this
     * reducer only accumulates it.
     */
    steady: boolean;
    /**
     * How long gross movement must persist before it wipes the accumulated
     * steady time.
     *
     * This exists because the first version reset to zero on a SINGLE
     * non-steady frame, which made the ring "reset at the slightest, slightest
     * movement" and the automatic photo physically impossible to reach by
     * hand. Brief movement now only pauses the count — the same tolerance the
     * detection credit already had, which this path should have had from the
     * start.
     */
    movementToleranceMs: number;
    /**
     * Accumulated steady time before the safety net fires an UNCROPPED photo.
     * Deliberately several times requiredDetectedMs so the detector always
     * gets first refusal — this is the floor, not the happy path.
     */
    requiredSteadyMs: number;
  },
): ShutterStep {
  const { detected, guidanceFor, graceMs, requiredDetectedMs, steady } = input;
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
  const requiredSteady =
    input.requiredSteadyMs > 0 ? input.requiredSteadyMs : Infinity;

  // Steadiness accrues regardless of detection. Movement PAUSES it and only
  // wipes it once the movement has persisted — a hand wobble must not undo
  // seconds of progress.
  const movingMs = steady ? 0 : prev.movingMs + elapsed;
  const tolerance =
    Number.isFinite(input.movementToleranceMs) && input.movementToleranceMs > 0
      ? input.movementToleranceMs
      : 0;
  const steadyMs = steady
    ? prev.steadyMs + elapsed
    : movingMs > tolerance
      ? 0
      : prev.steadyMs;
  const steadyReady = steadyMs >= requiredSteady;

  if (detected) {
    const detectedMs = prev.detectedMs + elapsed;
    const fire = detectedMs >= required || steadyReady;
    // Prefer the cropped route whenever detection got us there.
    const fireMode: FireMode | null = !fire
      ? null
      : detectedMs >= required
        ? "document"
        : "frame";
    return {
      // Firing spends the credit: without this the next frame fires again
      // immediately and the client gets a burst of near-identical photos,
      // each its own upload and its own AI check.
      state: {
        detectedMs: fire ? 0 : detectedMs,
        missMs: 0,
        movingMs,
        steadyMs: fire ? 0 : steadyMs,
      },
      outline: "update",
      documentPresent: true,
      guidance: guidanceFor(true),
      progress: fire ? 1 : clamp01(Math.max(detectedMs / required, steadyMs / requiredSteady)),
      fire,
      fireMode,
    };
  }

  const missMs = prev.missMs + elapsed;
  const withinGrace = missMs <= graceMs;
  // The credit HOLDS through a dropout (it neither drains nor accrues) and is
  // only forfeited once the document has been gone long enough that this is
  // plainly a different attempt, not a flicker.
  const detectedMs = missMs <= creditHoldMs ? prev.detectedMs : 0;
  return {
    state: {
      detectedMs,
      missMs,
      movingMs,
      steadyMs: steadyReady ? 0 : steadyMs,
    },
    outline: withinGrace ? "hold" : "clear",
    documentPresent: withinGrace,
    guidance: guidanceFor(withinGrace),
    progress: steadyReady
      ? 1
      : clamp01(Math.max(detectedMs / required, steadyMs / requiredSteady)),
    // The safety net: no document found, but the client has held the camera
    // still long enough that an uncropped photo beats no photo at all.
    fire: steadyReady,
    fireMode: steadyReady ? "frame" : null,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
