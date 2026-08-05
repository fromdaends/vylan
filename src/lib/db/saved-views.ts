// Saved views (1630) — a named filter set for one list, belonging to one person.
//
// `filters` is stored opaquely and VALIDATED ON READ rather than trusted: a view
// saved by an older build must not break a newer one, and a filter that has
// since been removed should be quietly dropped rather than crashing the list
// that renders it.

import { getServerSupabase } from "@/lib/supabase/server";
import {
  isSavedViewSurface,
  SAVED_VIEWS_MAX,
  type SavedView,
  type SavedViewSurface,
} from "@/lib/views/saved-view";

// Shape, surfaces and limits live in a NEUTRAL module so the client-side views
// menu can read them without pulling next/headers into the browser bundle.
// Re-exported so existing callers are unchanged.
export {
  SAVED_VIEW_SURFACES,
  SAVED_VIEWS_MAX,
  SAVED_VIEW_NAME_MAX,
  isSavedViewSurface,
} from "@/lib/views/saved-view";
export type { SavedView, SavedViewSurface } from "@/lib/views/saved-view";

const SELECT = "id, surface, name, filters, sort";

/** Missing TABLE (PGRST205 / 42P01) — degrade to "none" until 1630 lands, so a
 *  list renders exactly as it did before saved views existed. */
function isMissingTable(err: { code?: string | null } | null): boolean {
  return err?.code === "PGRST205" || err?.code === "42P01";
}

function toView(row: Record<string, unknown>): SavedView | null {
  const surface = row.surface;
  if (!isSavedViewSurface(surface)) return null;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  return {
    id: String(row.id),
    surface,
    name,
    // A blob that is not an object (null, an array, a string from a hand-edit)
    // reads as "no filters" rather than throwing — the view still opens, it
    // just shows everything.
    filters:
      row.filters && typeof row.filters === "object" && !Array.isArray(row.filters)
        ? (row.filters as Record<string, unknown>)
        : {},
    sort: typeof row.sort === "number" ? row.sort : 0,
  };
}

/** My views for one list, in my order. [] before 1630 / on error. */
export async function listSavedViews(
  surface: SavedViewSurface,
): Promise<SavedView[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("saved_views")
    .select(SELECT)
    .eq("surface", surface)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingTable(error)) {
      console.error("[saved-views] list failed:", error);
    }
    return [];
  }
  return ((data as Array<Record<string, unknown>> | null) ?? [])
    .map(toView)
    .filter((v): v is SavedView => v !== null);
}

export type SaveViewResult =
  | { ok: true; view: SavedView }
  | { ok: false; error: "duplicate" | "too_many" | "not_ready" | "failed" };

export async function createSavedView(input: {
  firmId: string;
  userId: string;
  surface: SavedViewSurface;
  name: string;
  filters: Record<string, unknown>;
}): Promise<SaveViewResult> {
  const sb = await getServerSupabase();

  const existing = await listSavedViews(input.surface);
  if (existing.length >= SAVED_VIEWS_MAX) return { ok: false, error: "too_many" };

  const { data, error } = await sb
    .from("saved_views")
    .insert({
      firm_id: input.firmId,
      user_id: input.userId,
      surface: input.surface,
      name: input.name,
      filters: input.filters,
      // Appended. Read the max rather than counting, so deleting one does not
      // make the next save collide with a number still in use.
      sort: (existing[existing.length - 1]?.sort ?? 0) + 10,
    })
    .select(SELECT)
    .single();

  if (error) {
    if (isMissingTable(error)) return { ok: false, error: "not_ready" };
    // 23505 is the (user, surface, lower(name)) index — two tabs with one name
    // is a strip that lies about which is which.
    if (error.code === "23505") return { ok: false, error: "duplicate" };
    console.error("[saved-views] create failed:", error);
    return { ok: false, error: "failed" };
  }
  const view = toView(data as Record<string, unknown>);
  return view ? { ok: true, view } : { ok: false, error: "failed" };
}

export async function renameSavedView(input: {
  id: string;
  name: string;
}): Promise<{ ok: boolean; error?: "duplicate" | "failed" }> {
  const sb = await getServerSupabase();
  const { error } = await sb
    .from("saved_views")
    .update({ name: input.name })
    .eq("id", input.id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "duplicate" };
    console.error("[saved-views] rename failed:", error);
    return { ok: false, error: "failed" };
  }
  return { ok: true };
}

/** Overwrite a view's filters with the list's CURRENT state. */
export async function updateSavedViewFilters(input: {
  id: string;
  filters: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
  const sb = await getServerSupabase();
  const { error } = await sb
    .from("saved_views")
    .update({ filters: input.filters })
    .eq("id", input.id);
  if (error) {
    console.error("[saved-views] update filters failed:", error);
    return { ok: false };
  }
  return { ok: true };
}

export async function deleteSavedView(id: string): Promise<{ ok: boolean }> {
  const sb = await getServerSupabase();
  const { error } = await sb.from("saved_views").delete().eq("id", id);
  if (error) {
    console.error("[saved-views] delete failed:", error);
    return { ok: false };
  }
  return { ok: true };
}
