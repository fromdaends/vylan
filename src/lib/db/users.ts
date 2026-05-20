import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";

export type AppUser = {
  id: string;
  firm_id: string;
  email: string;
  name: string;
  role: "owner" | "staff";
  locale: "fr" | "en";
  display_name: string | null;
  avatar_path: string | null;
  created_at: string;
};

// React.cache() deduplicates concurrent + repeated calls within a
// single request. (app)/layout and a downstream page both call this;
// without the wrapper the firm-row + auth-row queries fire twice on
// every navigation.
export const getCurrentUser = cache(async function _getCurrentUser(): Promise<AppUser | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  const { data: row } = await supabase
    .from("users")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!row) return null;

  // Reconcile users.email with auth.users.email when they drift apart.
  // Happens after a customer confirms a "change my email" link from
  // Supabase: auth.users gets the new email, our row still has the
  // old one. Sync once on the first request post-confirmation. Best-
  // effort: a failure here just leaves the row at the old value until
  // the next request retries (login still works either way since auth
  // is the source of truth for sign-in).
  const authEmail = data.user.email ?? null;
  if (
    typeof authEmail === "string" &&
    authEmail.toLowerCase() !== ((row as AppUser).email ?? "").toLowerCase()
  ) {
    const { data: synced } = await supabase
      .from("users")
      .update({ email: authEmail })
      .eq("id", data.user.id)
      .select("*")
      .maybeSingle();
    if (synced) return synced as AppUser;
  }

  return row as AppUser;
});

export type UserProfilePatch = {
  display_name?: string | null;
  locale?: "fr" | "en";
  avatar_path?: string | null;
};

/**
 * Update fields on the calling user's own `users` row. RLS policy
 * `users_update_self` (migration 0019) restricts writes to the row whose
 * `id = auth.uid()`, so this can safely use the user's authed client.
 */
export async function updateUserProfile(
  patch: UserProfilePatch,
): Promise<AppUser | null> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  // Build a strictly-typed update object; ignore undefined keys so callers
  // can pass a partial patch.
  const update: Record<string, unknown> = {};
  if (patch.display_name !== undefined) update.display_name = patch.display_name;
  if (patch.locale !== undefined) update.locale = patch.locale;
  if (patch.avatar_path !== undefined) update.avatar_path = patch.avatar_path;

  if (Object.keys(update).length === 0) {
    // Nothing to update — return the current row.
    return getCurrentUser();
  }

  const { data: row, error } = await supabase
    .from("users")
    .update(update)
    .eq("id", auth.user.id)
    .select("*")
    .single();
  if (error) throw error;
  return (row as AppUser) ?? null;
}

/**
 * Display label chain: explicit display_name → users.name → email local-part.
 */
export function userDisplayLabel(user: Pick<AppUser, "display_name" | "name" | "email">): string {
  if (user.display_name && user.display_name.trim()) return user.display_name.trim();
  if (user.name && user.name.trim()) return user.name.trim();
  return user.email.split("@")[0] ?? user.email;
}
