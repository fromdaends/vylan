// When to actually SAY something to the client.
//
// The coaching line used to be permanent: whatever the metrics thought, on
// screen, always. That reads as nagging — the founder asked for it to be
// subtler, rarer, and to pop up and disappear rather than sit there.
//
// Three rules, and each exists for a reason:
//
//   SETTLE   a hint must hold for a moment before it earns the screen, so a
//            metric flickering across its threshold cannot strobe text.
//   LINGER   once shown it stays briefly, then goes, whether or not the
//            condition persists. Advice you have already read is noise.
//   COOLDOWN the SAME hint will not come back for a good while. Repeating
//            "hold steady" every two seconds is what makes it nagging.
//
// Pure so it can be tested: the component owns only the timer that feeds it.

import { type Guidance } from "./frame-metrics";

export type HintState = {
  /** The hint currently on screen, if any. */
  visible: Guidance | null;
  /** How long it has been on screen. */
  visibleMs: number;
  /** A candidate waiting out the settle window. */
  pending: Guidance | null;
  pendingMs: number;
  /** Per-hint cooldown: ms since each was last shown. */
  lastShownAgoMs: Partial<Record<Guidance, number>>;
};

export const INITIAL_HINT: HintState = {
  visible: null,
  visibleMs: 0,
  pending: null,
  pendingMs: 0,
  lastShownAgoMs: {},
};

export type HintOptions = {
  /** How long a guidance must hold before it is allowed on screen. */
  settleMs: number;
  /** How long a hint stays once shown. */
  lingerMs: number;
  /** How long before the SAME hint may appear again. */
  cooldownMs: number;
};

/**
 * `ready` is deliberately never shown. It says nothing actionable — the
 * outline turning solid and the ring filling already say it, visually, without
 * a word. Suppressing it removes most of the on-screen text in the common
 * case, which is exactly the "less often" the founder asked for.
 */
function isWorthSaying(g: Guidance): boolean {
  return g !== "ready";
}

export function advanceHint(
  prev: HintState,
  input: { guidance: Guidance; elapsedMs: number } & HintOptions,
): { state: HintState; visible: Guidance | null } {
  const { guidance, settleMs, lingerMs, cooldownMs } = input;
  const elapsed =
    Number.isFinite(input.elapsedMs) && input.elapsedMs > 0
      ? Math.min(input.elapsedMs, 250)
      : 0;

  // Age every cooldown.
  const lastShownAgoMs: Partial<Record<Guidance, number>> = {};
  for (const [k, v] of Object.entries(prev.lastShownAgoMs)) {
    if (typeof v === "number") lastShownAgoMs[k as Guidance] = v + elapsed;
  }

  // Something already on screen: let it live out its welcome, then drop it.
  if (prev.visible) {
    const visibleMs = prev.visibleMs + elapsed;
    if (visibleMs < lingerMs) {
      return {
        state: { ...prev, visibleMs, lastShownAgoMs },
        visible: prev.visible,
      };
    }
    return {
      state: {
        visible: null,
        visibleMs: 0,
        pending: null,
        pendingMs: 0,
        // Its cooldown starts the moment it leaves, not when it arrived.
        lastShownAgoMs: { ...lastShownAgoMs, [prev.visible]: 0 },
      },
      visible: null,
    };
  }

  if (!isWorthSaying(guidance)) {
    return {
      state: { ...prev, pending: null, pendingMs: 0, lastShownAgoMs },
      visible: null,
    };
  }

  // Still in this hint's cooldown — say nothing, and do not let it build up a
  // settle credit while muted either.
  const ago = lastShownAgoMs[guidance];
  if (typeof ago === "number" && ago < cooldownMs) {
    return {
      state: { ...prev, pending: null, pendingMs: 0, lastShownAgoMs },
      visible: null,
    };
  }

  // Accumulate settle time for a stable candidate.
  const pendingMs = prev.pending === guidance ? prev.pendingMs + elapsed : 0;
  if (pendingMs < settleMs) {
    return {
      state: { ...prev, pending: guidance, pendingMs, lastShownAgoMs },
      visible: null,
    };
  }

  return {
    state: {
      visible: guidance,
      visibleMs: 0,
      pending: null,
      pendingMs: 0,
      lastShownAgoMs,
    },
    visible: guidance,
  };
}
