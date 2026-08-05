"use server";

// Saved views (1630) — create, rename, re-save and delete your own named filter
// sets for a list.
//
// No capability gate: these are PERSONAL. RLS scopes every path to
// user_id = auth.uid(), so the only thing this layer adds is validation and the
// firm id the row needs. A Junior naming their own tab is not a permission
// question.
//
// This file exports async functions ONLY — a "use server" module with a sync
// export typechecks, lints, passes every test, and then fails the production
// build naming something else entirely.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  createSavedView,
  deleteSavedView,
  isSavedViewSurface,
  renameSavedView,
  updateSavedViewFilters,
  SAVED_VIEW_NAME_MAX,
  type SavedView,
} from "@/lib/db/saved-views";
import { revalidateAllLocales } from "@/lib/revalidate";

export type SavedViewActionResult = {
  ok: boolean;
  view?: SavedView;
  error?:
    | "no_session"
    | "bad_surface"
    | "bad_name"
    | "duplicate"
    | "too_many"
    | "not_ready"
    | "failed";
};

/** Collapse whitespace and cap it — a tab is read at a glance. Empty is not a
 *  name; it would render an unclickable sliver in the strip. */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, SAVED_VIEW_NAME_MAX);
  return name || null;
}

/** The filter blob, defensively. Anything that is not a plain object becomes
 *  "no filters" — a view that shows everything, rather than a write that fails
 *  or a row that breaks the list rendering it. */
function cleanFilters(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function revalidateLists(): void {
  revalidateAllLocales("/engagements");
  revalidateAllLocales("/work");
  revalidateAllLocales("/clients");
}

export async function createSavedViewAction(input: {
  surface: string;
  name: string;
  filters: unknown;
}): Promise<SavedViewActionResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!isSavedViewSurface(input.surface)) {
    return { ok: false, error: "bad_surface" };
  }
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "bad_name" };

  const res = await createSavedView({
    firmId: firm.id,
    userId: user.id,
    surface: input.surface,
    name,
    filters: cleanFilters(input.filters),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateLists();
  return { ok: true, view: res.view };
}

export async function renameSavedViewAction(input: {
  id: string;
  name: string;
}): Promise<SavedViewActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "no_session" };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "bad_name" };

  // RLS is what actually scopes this to the caller's own row — an id belonging
  // to somebody else simply updates nothing.
  const res = await renameSavedView({ id: input.id, name });
  if (!res.ok) return { ok: false, error: res.error ?? "failed" };
  revalidateLists();
  return { ok: true };
}

/** Point an existing view at the list's CURRENT filters — "update this view to
 *  what I am looking at now", which is how a saved view stops going stale. */
export async function resaveSavedViewAction(input: {
  id: string;
  filters: unknown;
}): Promise<SavedViewActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "no_session" };
  const res = await updateSavedViewFilters({
    id: input.id,
    filters: cleanFilters(input.filters),
  });
  if (!res.ok) return { ok: false, error: "failed" };
  revalidateLists();
  return { ok: true };
}

export async function deleteSavedViewAction(input: {
  id: string;
}): Promise<SavedViewActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "no_session" };
  const res = await deleteSavedView(input.id);
  if (!res.ok) return { ok: false, error: "failed" };
  revalidateLists();
  return { ok: true };
}
