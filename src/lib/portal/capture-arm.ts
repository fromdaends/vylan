// Re-arm gate for the auto-shutter's multi-page loop.
//
// "Add another page" banks the shot and drops the client straight back on the
// camera — pointing at the very sheet that was just captured. The shutter's
// own credit-spend only buys ~1.2s; hold still past that and the SAME page
// fires again, and every duplicate is its own upload and its own AI check. So
// after banking a page the AUTO shutter is disarmed until the scene visibly
// changes: the document leaves the frame (they are swapping pages) or its
// corners move well past detection jitter (they are repositioning).
//
// This gates ONLY the automatic fire. The manual shutter button never waits,
// and Retake never disarms — a client who rejected a shot wants the same
// document captured again, immediately.

import type { Quad } from "./rectify";

export type ArmState = {
  armed: boolean;
  /** Where the document sat when the page was banked, in detect-canvas px. */
  reference: Quad | null;
  /** ms since the disarm. */
  sinceMs: number;
  /** ms of continuous no-detection while disarmed. */
  missMs: number;
};

export const ARMED: ArmState = {
  armed: true,
  reference: null,
  sinceMs: 0,
  missMs: 0,
};

export function disarm(reference: Quad | null): ArmState {
  return { armed: false, reference, sinceMs: 0, missMs: 0 };
}

/** The largest single-corner displacement between two quads. */
export function maxCornerDelta(a: Quad, b: Quad): number {
  let max = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    if (d > max) max = d;
  }
  return max;
}

export function advanceArm(
  prev: ArmState,
  input: {
    /** This frame's RAW detection, in detect-canvas px (null = not found). */
    quad: Quad | null;
    elapsedMs: number;
    /** Hard floor before any re-arm — the anti-double-fire debounce. */
    minDelayMs: number;
    /** Corner movement past this (detect px) counts as "visibly moved". */
    moveTolerancePx: number;
    /** Continuous absence past this counts as "document left the frame". */
    clearMissMs: number;
  },
): ArmState {
  if (prev.armed) return prev;

  const elapsed =
    Number.isFinite(input.elapsedMs) && input.elapsedMs > 0
      ? Math.min(input.elapsedMs, 250)
      : 0;
  const sinceMs = prev.sinceMs + elapsed;
  const missMs = input.quad ? 0 : prev.missMs + elapsed;

  if (sinceMs >= input.minDelayMs) {
    if (missMs >= input.clearMissMs) return ARMED;
    if (input.quad) {
      // No reference to compare against (the banked shot came from the
      // safety-net uncropped path, which has no quad): time alone re-arms
      // rather than locking auto-capture out for the rest of the session.
      if (!prev.reference) return ARMED;
      if (maxCornerDelta(input.quad, prev.reference) > input.moveTolerancePx) {
        return ARMED;
      }
    }
  }

  return { armed: false, reference: prev.reference, sinceMs, missMs };
}
