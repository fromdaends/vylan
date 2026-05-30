// Command-palette recency — stored per-device in localStorage (no backend).
// Two independent most-recent-first lists, deduped and capped:
//   - searches: the query strings the user ran from the palette
//   - items:    the clients / engagements the user opened from the palette
// Best-effort: a disabled or full localStorage simply means no recents, never
// an error (mirrors the jump-back.ts approach).

const SEARCHES_KEY = "vylan:cmdk:searches";
const ITEMS_KEY = "vylan:cmdk:items";
const MAX_SEARCHES = 6;
const MAX_ITEMS = 6;

export type RecentItem = {
  kind: "client" | "engagement";
  id: string;
  title: string;
  subtitle?: string;
};

function readArray(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArray(key: string, value: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore (private mode, quota, SSR)
  }
}

export function readRecentSearches(): string[] {
  return readArray(SEARCHES_KEY)
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .slice(0, MAX_SEARCHES);
}

export function recordSearch(query: string): void {
  const q = query.trim();
  if (!q) return;
  const next = [
    q,
    ...readRecentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase()),
  ].slice(0, MAX_SEARCHES);
  writeArray(SEARCHES_KEY, next);
}

export function readRecentItems(): RecentItem[] {
  return readArray(ITEMS_KEY)
    .filter(
      (it): it is RecentItem =>
        !!it &&
        typeof it === "object" &&
        ((it as RecentItem).kind === "client" ||
          (it as RecentItem).kind === "engagement") &&
        typeof (it as RecentItem).id === "string" &&
        typeof (it as RecentItem).title === "string",
    )
    .slice(0, MAX_ITEMS);
}

export function recordItem(item: RecentItem): void {
  if (!item?.id || !item?.title) return;
  const clean: RecentItem = {
    kind: item.kind,
    id: item.id,
    title: item.title,
    ...(item.subtitle ? { subtitle: item.subtitle } : {}),
  };
  const next = [
    clean,
    ...readRecentItems().filter(
      (it) => !(it.kind === clean.kind && it.id === clean.id),
    ),
  ].slice(0, MAX_ITEMS);
  writeArray(ITEMS_KEY, next);
}

export function clearRecents(): void {
  writeArray(SEARCHES_KEY, []);
  writeArray(ITEMS_KEY, []);
}
