// Public teammate-invite accept page: /{locale}/invite/{token}.
//
// Server-side, we hash the raw token, look the invite up by its hash, resolve
// the firm + inviter for the header, re-check the seat cap, and decide via
// resolveInviteAccess whether to show the create-account form or a calm error
// card. acceptInvite re-validates all of this on submit (defence in depth).

import type { Metadata } from "next";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  hashInviteToken,
  resolveInviteAccess,
  canSwitchFromCurrentFirm,
} from "@/lib/team/invites";
import { getFirmSeatUsage, hasRoomForMember } from "@/lib/billing/seats";
import {
  InviteAcceptForm,
  InviteSwitchForm,
  InviteErrorView,
} from "./invite-client";

// Same reasoning as the client portal (src/app/r/[token]/page.tsx): a private
// token URL that names a real firm and a real person who invited you. Nothing
// here belongs in a search index, and the invite email is exactly the kind of
// thing that gets forwarded into an archived mailing list.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

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

  if (access !== "ok" || !invite) {
    return (
      <InviteErrorView
        reason={access === "ok" ? "not_found" : access}
        firmName={firmName}
        inviterName={inviterName}
      />
    );
  }

  // Does the invited email already have a Vylan account? If so this is a
  // "switch over": verify their password + move their account into this firm,
  // rather than creating a new one. Decide which card to render.
  const { data: existing } = await admin
    .from("users")
    .select("id, firm_id, role")
    .eq("email", invite.email)
    .maybeSingle();

  if (!existing) {
    return (
      <InviteAcceptForm
        firmName={firmName}
        inviterName={inviterName}
        locale={locale}
        token={token}
      />
    );
  }

  // Already a member of THIS firm — nothing to switch.
  if (existing.firm_id === invite.firm_id) {
    return (
      <InviteErrorView
        reason="already_member"
        firmName={firmName}
        inviterName={inviterName}
      />
    );
  }

  // Resolve their current firm name (for the warning copy) and enforce the
  // "can't strand a team" guardrail before offering the switch.
  const { data: oldFirm } = await admin
    .from("firms")
    .select("name")
    .eq("id", existing.firm_id)
    .maybeSingle();
  const currentFirmName = oldFirm?.name ?? "";

  if (existing.role === "owner") {
    const nowIso = new Date().toISOString();
    const [others, pendingInvites] = await Promise.all([
      admin
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("firm_id", existing.firm_id)
        .is("deactivated_at", null)
        .neq("id", existing.id),
      admin
        .from("firm_invites")
        .select("id", { count: "exact", head: true })
        .eq("firm_id", existing.firm_id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", nowIso),
    ]);
    const guard = canSwitchFromCurrentFirm({
      role: "owner",
      otherActiveMembers: others.count ?? 0,
      pendingInvites: pendingInvites.count ?? 0,
    });
    if (!guard.ok) {
      return (
        <InviteErrorView
          reason="owns_team"
          firmName={firmName}
          inviterName={inviterName}
        />
      );
    }
  }

  return (
    <InviteSwitchForm
      firmName={firmName}
      inviterName={inviterName}
      inviteEmail={invite.email as string}
      currentFirmName={currentFirmName}
      locale={locale}
      token={token}
    />
  );
}
