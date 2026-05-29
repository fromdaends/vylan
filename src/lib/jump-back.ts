// "Jump back in" recency tracking — stored per-device in localStorage (no
// backend). Visiting an engagement records its id + the time; the dashboard
// only surfaces the card if that open happened within RECENT_WINDOW_MS, so it
// quietly expires after a stretch of not using the app and comes back the next
// time an engagement is opened.

const KEY = "vylan:jump-back";
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type Stored = { id: string; openedAt: number };

// Record that the user just opened an engagement. Best-effort — a disabled or
// full localStorage simply means no "Jump back in" card, never an error.
export function recordOpen(id: string): void {
  try {
    const value: Stored = { id, openedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // ignore (private mode, quota, SSR)
  }
}

// The most recently opened engagement id, or null if there isn't one or the
// last open is older than the window (expired).
export function readRecentOpenId(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.id !== "string" || typeof parsed.openedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.openedAt > RECENT_WINDOW_MS) return null;
    return parsed.id;
  } catch {
    return null;
  }
}
