// Per-user, client-side preferences for the Assistant panel. Everything is
// localStorage-backed with the app's `vylan:` prefix and per-user keys (same
// convention as vylan:eng-scope:${userId} in engagements-view.tsx), wrapped in
// try/catch so a blocked storage API can never throw into React.

// ---------------------------------------------------------------------------
// Panel width
// ---------------------------------------------------------------------------

// Bounds from the founder spec: never narrower than ~400px (content crushes),
// never wider than 60% of the viewport (the page behind must stay usable).
// Default is 35% of the viewport.
export const PANEL_MIN_WIDTH_PX = 400;
export const PANEL_MAX_FRACTION = 0.6;
export const PANEL_DEFAULT_FRACTION = 0.35;

export function clampPanelWidth(px: number, viewportWidth: number): number {
  // Guarantee max >= min even on tiny viewports (the px width only applies
  // on sm+ screens — mobile goes full-width via CSS — but stay safe).
  const max = Math.max(PANEL_MIN_WIDTH_PX, viewportWidth * PANEL_MAX_FRACTION);
  return Math.round(Math.min(Math.max(px, PANEL_MIN_WIDTH_PX), max));
}

export function defaultPanelWidth(viewportWidth: number): number {
  return clampPanelWidth(
    viewportWidth * PANEL_DEFAULT_FRACTION,
    viewportWidth,
  );
}

function widthKey(userId: string): string {
  return `vylan:assistant:width:${userId}`;
}

export function readStoredPanelWidth(userId: string): number | null {
  try {
    const raw = window.localStorage.getItem(widthKey(userId));
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function storePanelWidth(userId: string, px: number) {
  try {
    window.localStorage.setItem(widthKey(userId), String(Math.round(px)));
  } catch {
    // Storage blocked — the width just won't persist. Non-fatal.
  }
}

// Double-click reset: forget the stored width entirely so the panel goes back
// to tracking 35% of whatever viewport it opens on next.
export function clearStoredPanelWidth(userId: string) {
  try {
    window.localStorage.removeItem(widthKey(userId));
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// "Seen" engagements (FAB badge)
// ---------------------------------------------------------------------------

// The FAB shows a small dot inviting the accountant in when they're viewing a
// fresh engagement they haven't opened the panel on yet. "Seen" is a capped,
// most-recent-first id list per user.

const SEEN_CAP = 100;

function seenKey(userId: string): string {
  return `vylan:assistant:seen:${userId}`;
}

export function readSeenEngagements(userId: string): string[] {
  try {
    const raw = window.localStorage.getItem(seenKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

export function markEngagementSeen(userId: string, engagementId: string) {
  try {
    const current = readSeenEngagements(userId);
    const next = [
      engagementId,
      ...current.filter((id) => id !== engagementId),
    ].slice(0, SEEN_CAP);
    window.localStorage.setItem(seenKey(userId), JSON.stringify(next));
  } catch {
    // Non-fatal.
  }
}

// A fresh engagement invites the accountant in for at most this long. After
// that the dot would be noise, not an invitation.
export const BADGE_MAX_AGE_DAYS = 7;

export function isFreshEngagement(
  status: string,
  createdAt: string,
  now: number,
): boolean {
  if (status !== "draft" && status !== "sent") return false;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  const ageDays = (now - created) / (24 * 60 * 60 * 1000);
  return ageDays >= 0 && ageDays <= BADGE_MAX_AGE_DAYS;
}
