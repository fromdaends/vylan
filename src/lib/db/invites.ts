import { getServerSupabase } from "@/lib/supabase/server";

export type FirmInvite = {
  id: string;
  email: string;
  role: "owner" | "staff";
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by_user_id: string | null;
  created_at: string;
};

// The firm's outstanding invitations (not yet accepted, not revoked — includes
// expired ones, which the team page shows as "Expired" with a Resend action).
// Owner-only via RLS (firm_invites_select_owner from migration 0190); the team
// page is owner-gated, so the authed client is the right least-privilege path.
export async function listFirmInvites(): Promise<FirmInvite[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("firm_invites")
    .select(
      "id, email, role, expires_at, accepted_at, revoked_at, invited_by_user_id, created_at",
    )
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[invites] list failed:", error.message);
    return [];
  }
  return (data ?? []) as FirmInvite[];
}
