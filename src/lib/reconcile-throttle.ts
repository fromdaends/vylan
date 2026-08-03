// Render-path reconcile throttle.
//
// The engagement + client pages "self-heal" pending payments and signatures by
// asking Stripe / PayPal / SignWell directly when a webhook might have been
// missed. That is the right safety net for a fresh page visit — but those
// pages also re-render every 5 seconds under AutoRefresh, and "requested" /
// "sent" is the NORMAL state of an invoice or signature for hours or days. An
// accountant sitting on an engagement with one unpaid invoice and one
// out-for-signature item was costing a live Stripe call plus a SignWell call
// per tick: ~720 external API round trips per hour per open tab, each sitting
// serially inside the page's time-to-render.
//
// shouldReconcile(key) returns true at most once per TTL per key, so a fresh
// navigation still heals within a minute while AutoRefresh ticks skip the
// external call and render straight from the DB row. Webhooks remain the
// primary path; this only bounds how often the BACKUP path runs.
//
// Best-effort by design: the map is per-server-instance memory. On Vercel a
// cold start or a tick landing on a different instance reconciles again —
// that's fine, the point is to collapse the steady 5-second hammering on the
// warm instance that serves it, not to guarantee exactly-once.
const lastRun = new Map<string, number>();

// A minute keeps the safety net honest (a broken webhook still surfaces
// "Paid" within ≤60s on an open tab) while cutting the steady-state external
// call rate by ~92%.
export const RECONCILE_TTL_MS = 60_000;

// Bound the map so a long-lived instance serving many firms can't grow it
// forever. Prune expired entries first; if everything is somehow live, drop
// the map — worst case is one extra reconcile per key.
const MAX_KEYS = 5_000;

export function shouldReconcile(
  key: string,
  ttlMs: number = RECONCILE_TTL_MS,
  now: number = Date.now(),
): boolean {
  const prev = lastRun.get(key);
  if (prev !== undefined && now - prev < ttlMs) return false;
  if (lastRun.size >= MAX_KEYS) {
    for (const [k, t] of lastRun) {
      if (now - t >= ttlMs) lastRun.delete(k);
    }
    if (lastRun.size >= MAX_KEYS) lastRun.clear();
  }
  lastRun.set(key, now);
  return true;
}

/** Test-only: forget every throttle timestamp between cases. */
export function __resetReconcileThrottleForTests(): void {
  lastRun.clear();
}
