// The saved-view SHAPE and its limits — a PLAIN module on purpose.
//
// ⚠️ WHY THIS IS NOT IN lib/db/saved-views.ts. That file imports
// getServerSupabase, which imports next/headers, which is server-only. The
// views MENU is a client component and needs the name cap to set maxLength on
// its input — importing it from the db module dragged next/headers into the
// browser bundle and failed the production build with "You're importing a
// module that depends on next/headers".
//
// NOTHING ELSE CATCHES THIS. `tsc --noEmit` was clean and 5150 tests passed;
// only `next build` said a word. Same trap, same fix as lib/clients/note.ts
// (CLIENT_NOTE_MAX) and lib/files/upload-limits.ts — constants and types a
// client component needs live in a neutral module, and the server file
// re-exports them so existing callers are unchanged.

export const SAVED_VIEW_SURFACES = [
  "engagements",
  "tasks",
  "clients",
] as const;
export type SavedViewSurface = (typeof SAVED_VIEW_SURFACES)[number];

export function isSavedViewSurface(v: unknown): v is SavedViewSurface {
  return (SAVED_VIEW_SURFACES as readonly string[]).includes(v as string);
}

export type SavedView = {
  id: string;
  surface: SavedViewSurface;
  name: string;
  /** The list's own filter state. Shape is the list's business, not this
   *  module's — see migration 1630 for why it is a blob. */
  filters: Record<string, unknown>;
  sort: number;
};

/** How many one person may keep per list. A tab strip is read left to right;
 *  past a dozen it stops being navigation and becomes a search problem. */
export const SAVED_VIEWS_MAX = 12;

/** Long enough to say "Overdue, mine, this week", short enough to be a tab. */
export const SAVED_VIEW_NAME_MAX = 40;
