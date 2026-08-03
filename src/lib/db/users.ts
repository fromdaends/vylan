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
  // Soft "removed from the firm" (Phase 1 migration). Set = deactivated:
  // can't sign in, frees a seat, and is excluded from assignment targets.
  // Still appears in historical records (activity log, past assignments).
  deactivated_at: string | null;
  deactivated_by_user_id: string | null;
  created_at: string;
  // Phase 2 per-person permissions (migration 1120). OPTIONAL on purpose: they
  // are undefined until that migration is applied, and src/lib/auth/
  // capabilities.ts treats undefined exactly like null — which resolves to the
  // member preset. So a row read before the migration lands behaves as it
  // always has, rather than failing or silently restricting anyone.
  permission_preset?: string | null;
  extra_capabilities?: string[] | null;
  // Phase 2 profile (migration 1190). OPTIONAL for the same reason as the two
  // above: undefined until the migration lands, and every reader treats
  // undefined and null identically — "not recorded". Nobody is assumed to be
  // full time.
  job_title?: string | null;
  weekly_hours?: number | null;
  // Everything this person's firm roles grant (1260), unioned and attached by
  // getCurrentUser. Not a users column — it is assembled per request so that
  // capabilitiesFor() can read it straight off an AppUser.
  role_capabilities?: readonly string[] | null;
  // OUTSIDE COLLABORATOR (migration 1300). A contractor scoped to the clients
  // they are on: no firm roster, no 'listed' clients, no seat, and an EMPTY
  // capability floor. Still role = "staff" — users.role keeps its two values
  // forever, because RLS is written against them.
  //
  // Optional like the rest: undefined until 1300 is applied, and every reader
  // treats undefined as false. The flag only ever NARROWS, so a missing column
  // leaves everybody exactly as they were.
  is_external?: boolean | null;
};

/** Active firm members only (not deactivated) — the valid targets for
 *  engagement assignment + the team-size count. */
export async function listActiveFirmUsers(): Promise<AppUser[]> {
  return (await listFirmUsers()).filter((u) => !u.deactivated_at);
}

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

  return withRoleCapabilities(row as AppUser);
});

// Attach what this person's firm roles grant (1260).
//
// Done HERE rather than at each call site so every existing can() keeps working
// untouched: capabilitiesFor() reads role_capabilities off the subject, and the
// subject is almost always this object. Adding it anywhere else would have
// meant auditing ~100 call sites for the ones that forgot.
//
// One extra query per request, not per call — getCurrentUser is React.cache'd.
// A failure returns the user WITHOUT role grants rather than throwing: losing a
// granted capability degrades to the preset, which is the safe direction; a
// throw would take down every page that asks who you are.
async function withRoleCapabilities(user: AppUser): Promise<AppUser> {
  try {
    const { roleCapabilitiesForUser } = await import("@/lib/db/firm-roles");
    const caps = await roleCapabilitiesForUser(user.id);
    return caps.length > 0 ? { ...user, role_capabilities: caps } : user;
  } catch (err) {
    console.error("[users] could not read role grants:", err);
    return user;
  }
}

/**
 * All members of the caller's firm. RLS policy `users_select` (migration
 * 0002) already scopes SELECT to `firm_id = current_firm_id()`, so this
 * returns only same-firm rows without an explicit filter. Used to resolve
 * an engagement's `assigned_user_id` to a display name and to power the
 * "assigned to me" worklist filter.
 */
export async function listFirmUsers(): Promise<AppUser[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AppUser[];
}

export type UserProfilePatch = {
  display_name?: string | null;
  locale?: "fr" | "en";
  avatar_path?: string | null;
  // Migration 1190. These are the PERSON's to set, not the firm's — which is
  // why they go through this self-scoped update (RLS users_update_self) rather
  // than the service-role roster writes in app/actions/team.ts. An owner reads
  // them on the teammate page; only Clarence changes Clarence's hours.
  job_title?: string | null;
  weekly_hours?: number | null;
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
  if (patch.job_title !== undefined) update.job_title = patch.job_title;
  if (patch.weekly_hours !== undefined) update.weekly_hours = patch.weekly_hours;

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
