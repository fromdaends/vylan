// Public teammate-invite accept page: /{locale}/invite/{token}.
//
// Server-side, we hash the raw token, look the invite up by its hash, resolve
// the firm + inviter for the header, re-check the seat cap, and decide via
// resolveInviteAccess whether to show the create-account form or a calm error
// card. acceptInvite re-validates all of this on submit (defence in depth).

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { hashInviteToken, resolveInviteAccess } from "@/lib/team/invites";
import { getFirmSeatUsage, hasRoomForMember } from "@/lib/billing/seats";
import { InviteAcceptForm, InviteErrorView } from "./invite-client";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale: "fr" | "en" = rawLocale === "en" ? "en" : "fr";

  const admin = getServiceRoleSupabase();
  const { data: invite } = await admin
    .from("firm_invites")
    .select(
      "id, firm_id, email, invited_by_user_id, accepted_at, revoked_at, expires_at",
    )
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();

  // Resolve firm name + inviter name (best-effort) for the header/error copy.
  let firmName = "";
  let inviterName = "";
  let hasRoom = false;
  if (invite) {
    const { data: firm } = await admin
      .from("firms")
      .select("name")
      .eq("id", invite.firm_id)
      .maybeSingle();
    firmName = firm?.name ?? "";

    if (invite.invited_by_user_id) {
      const { data: inviter } = await admin
        .from("users")
        .select("name, display_name, email")
        .eq("id", invite.invited_by_user_id)
        .maybeSingle();
      inviterName =
        inviter?.display_name?.trim() ||
        inviter?.name?.trim() ||
        (inviter?.email ? inviter.email.split("@")[0] : "") ||
        "";
    }

    hasRoom = hasRoomForMember(await getFirmSeatUsage(invite.firm_id));
  }

  const access = resolveInviteAccess(invite ?? null, hasRoom);

  if (access !== "ok") {
    return (
      <InviteErrorView
        reason={access}
        firmName={firmName}
        inviterName={inviterName}
      />
    );
  }

  return (
    <InviteAcceptForm
      firmName={firmName}
      inviterName={inviterName}
      locale={locale}
      token={token}
    />
  );
}
