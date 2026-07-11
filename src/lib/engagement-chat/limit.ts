// Rolling-window rate-limit math for the engagement chat. Pure — the route
// feeds it the user's `user`-turn timestamps from chat_messages and a clock.

import { CHAT_MESSAGE_LIMIT, CHAT_WINDOW_HOURS } from "./config";

export type ChatLimitState = {
  limit: number;
  used: number;
  remaining: number;
  // When the NEXT message frees up, ISO string — null while under the limit.
  // With a rolling window this is the moment enough old messages age out
  // that used drops below limit again.
  resetAt: string | null;
};

export function computeChatLimitState(
  userTurnTimesIso: string[],
  nowMs: number,
  limit: number = CHAT_MESSAGE_LIMIT,
  windowHours: number = CHAT_WINDOW_HOURS,
): ChatLimitState {
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = nowMs - windowMs;

  const inWindow = userTurnTimesIso
    .map((iso) => new Date(iso).getTime())
    .filter((t) => Number.isFinite(t) && t > cutoff)
    .sort((a, b) => a - b);

  const used = inWindow.length;
  const remaining = Math.max(0, limit - used);

  let resetAt: string | null = null;
  if (used >= limit) {
    // Capacity for one more message frees when enough of the oldest
    // in-window turns age out: the (used - limit)th oldest (0-based) is the
    // one whose expiry brings `used` back under `limit`.
    const freeing = inWindow[used - limit];
    if (freeing != null) {
      resetAt = new Date(freeing + windowMs).toISOString();
    }
  }

  return { limit, used, remaining, resetAt };
}
