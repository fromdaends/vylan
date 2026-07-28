// Bookkeeping for the self-firing shutter and the outline's on-screen
// persistence. Pure so it can be tested properly: the scanning loop it drives
// lives inside a requestAnimationFrame callback reading a canvas, and neither
// runs under the test DOM (no canvas) nor reliably in a headless browser (a
// hidden page has rAF paused entirely).
//
// This is measured in MILLISECONDS, not frames, and that is the point. The
// first version required N consecutive good frames, which had two failures on a
// real phone:
//
//   * Frame-rate coupling. "Six frames" means 0.6s at 10fps and 0.3s at 20fps,
//     so tuning the loop's speed silently retuned the shutter.
//   * All-or-nothing. Four separate conditions all had to hold on the SAME
//     frame, and ONE marginal reading reset the count to zero. Hand-held, with
//     four metrics flickering around their thresholds, a run of six was
//     genuinely hard to hit — so the shutter never fired.
//
// Confidence now ACCUMULATES while the frame looks good and DRAINS while it
// does not, so a single marginal frame costs progress instead of erasing it.

import { type Guidance } from "./frame-metrics";

export type ShutterState = {
  /** Milliseconds of accumulated "this frame is worth shooting" credit. */
  readyMs: number;
  /** Milliseconds since a document was last seen. */
  missMs: number;
};

export const INITIAL_SHUTTER: ShutterState = { readyMs: 0, missMs: 0 };

/**
 * How fast credit drains, as a multiple of real time.
 *
 * Draining faster than it fills means a client who is mostly-but-not-quite
 * steady never creeps up to the threshold; draining too fast reproduces the
 * all-or-nothing bug. 1.5x costs a marginal frame more than it earned without
 * wiping the run.
 */
const DRAIN_FRAMED = 1.5;
/** Losing the document entirely is a stronger signal, so it drains faster. */
const DRAIN_LOST = 2.5;

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
  /** The guidance to show for this frame. */
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
     * reducer owns, and guidance in turn decides whether credit accrues — so
     * the two have to be resolved together rather than by the caller.
     */
    guidanceFor: (documentPresent: boolean) => Guidance;
    /** Real time since the previous analysed frame. */
    elapsedMs: number;
    /** How long the outline survives after the document is lost. */
    graceMs: number;
    /** Accumulated good time before the shutter fires. */
    requiredReadyMs: number;
  },
): ShutterStep {
  const { detected, guidanceFor, graceMs, requiredReadyMs } = input;
  // A hidden tab, a stalled decode or a debugger pause can hand us a gap of
  // several seconds; crediting or draining all of it would either fire on a
  // frame nobody was looking at or wipe a good run. Treat a long gap as one
  // ordinary step.
  const elapsed =
    Number.isFinite(input.elapsedMs) && input.elapsedMs > 0
      ? Math.min(input.elapsedMs, 250)
      : 0;

  const required = requiredReadyMs > 0 ? requiredReadyMs : Infinity;

  if (!detected) {
    const missMs = prev.missMs + elapsed;
    const documentPresent = missMs <= graceMs;
    return {
      state: {
        readyMs: Math.max(0, prev.readyMs - elapsed * DRAIN_LOST),
        missMs,
      },
      outline: documentPresent ? "hold" : "clear",
      documentPresent,
      guidance: guidanceFor(documentPresent),
      progress: clamp01(
        Math.max(0, prev.readyMs - elapsed * DRAIN_LOST) / required,
      ),
      fire: false,
    };
  }

  const guidance = guidanceFor(true);
  const readyMs =
    guidance === "ready"
      ? prev.readyMs + elapsed
      : Math.max(0, prev.readyMs - elapsed * DRAIN_FRAMED);

  const fire = readyMs >= required;
  return {
    // Firing spends the credit: without this the next frame fires again
    // immediately and the client gets a burst of near-identical photos, each
    // its own upload and its own AI check.
    state: { readyMs: fire ? 0 : readyMs, missMs: 0 },
    outline: "update",
    documentPresent: true,
    guidance,
    progress: fire ? 1 : clamp01(readyMs / required),
    fire,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
