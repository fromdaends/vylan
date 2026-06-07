"use server";

// Owner-only teammate-invitation actions. All writes use the service-role
// client (firm_invites is locked to service-role writes by migration 0190);
// the owner check is the gate. Each action returns a small result object whose
// `error` code the UI (Phase 6) maps to a friendly bilingual message.

import { revalidatePath } from "next/cache";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { logUserActivity } from "@/lib/db/activity";
import { assertCanAddSeat, SeatLimitError } from "@/lib/billing/seats";
import { sendEmail, buildTeamInviteEmail } from "@/lib/email";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiryISO,
  inviteAcceptUrl,
  parseInviteEmail,
} from "@/lib/team/invites";

// The team list (built in Phase 6) lives here; revalidating it keeps the
// pending-invites view fresh after a mutation. No-op until the route exists.
const TEAM_PATH = "/settings/team";

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

function localeFrom(
  raw: FormDataEntryValue | null,
  fallback: "fr" | "en",
): "fr" | "en" {
  return raw === "fr" || raw === "en" ? raw : fallback;
}

export type CreateInviteResult =
  | { ok: true; inviteId: string; emailSent: boolean }
  | {
      ok: false;
      error:
        | "no_session"
        | "owner_only"
        | "invalid_email"
        | "seat_limit"
        | "email_exists"
        | "already_invited"
        | "insert_failed";
      cap?: number;
    };

// Owner-only. Validate email -> seat check -> "not already a Vylan user" ->
// no duplicate live invite -> mint token, store its hash, insert -> email ->
// log. The raw token is emailed once and never persisted.
export async function createInvite(
  formData: FormData,
): Promise<CreateInviteResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (user.role !== "owner") return { ok: false, error: "owner_only" };

  const parsed = parseInviteEmail(formData.get("email"));
  if (!parsed.ok) return { ok: false, error: "invalid_email" };
  const email = parsed.email;

  // Seat cap = active members + pending invites vs the firm's cap.
  try {
    await assertCanAddSeat(firm.id);
  } catch (e) {
    if (e instanceof SeatLimitError) {
      return { ok: false, error: "seat_limit", cap: e.cap };
    }
    throw e;
  }

  const admin = getServiceRoleSupabase();

  // Cannot invite an email already tied to ANY Vylan account (email is globally
  // unique on users; citext makes this case-insensitive).
  const { data: existingUser } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingUser) return { ok: false, error: "email_exists" };

  // Don't stack duplicate live invites for the same firm + email — each would
  // consume a seat. The owner should resend/revoke the existing one instead.
  const nowIso = new Date().toISOString();
  const { data: existingInvite } = await admin
    .from("firm_invites")
    .select("id")
    .eq("firm_id", firm.id)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (existingInvite) return { ok: false, error: "already_invited" };

  const rawToken = generateInviteToken();
  const locale = localeFrom(
    formData.get("locale"),
    firm.locale_default ?? user.locale,
  );

  const { data: inserted, error: insertErr } = await admin
    .from("firm_invites")
    .insert({
      firm_id: firm.id,
      email,
      role: "staff",
      token_hash: hashInviteToken(rawToken),
      expires_at: inviteExpiryISO(),
      invited_by_user_id: user.id,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    console.error("[team] createInvite insert failed:", insertErr?.message);
    return { ok: false, error: "insert_failed" };
  }

  const email_ = buildTeamInviteEmail({
    firmName: firm.name,
    inviterName: userDisplayLabel(user),
    acceptUrl: inviteAcceptUrl(appUrl(), locale, rawToken),
    locale,
  });
  const send = await sendEmail({
    to: email,
    subject: email_.subject,
    html: email_.html,
    text: email_.text,
  });

  await logUserActivity(firm.id, null, "invite_created", {
    invite_id: inserted.id,
    role: "staff",
  });

  revalidatePath(TEAM_PATH);
  return { ok: true, inviteId: inserted.id, emailSent: send.sent };
}

export type InviteMutationResult =
  | { ok: true }
  | {
      ok: false;
      error: "no_session" | "owner_only" | "not_found" | "update_failed";
    };

// Owner-only. Marks a still-pending invite revoked (frees its seat). Already-
// accepted or already-revoked invites can't be revoked again.
export async function revokeInvite(
  inviteId: string,
): Promise<InviteMutationResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (user.role !== "owner") return { ok: false, error: "owner_only" };

  const admin = getServiceRoleSupabase();
  const { data: updated, error } = await admin
    .from("firm_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("firm_id", firm.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[team] revokeInvite failed:", error.message);
    return { ok: false, error: "update_failed" };
  }
  if (!updated) return { ok: false, error: "not_found" };

  await logUserActivity(firm.id, null, "invite_revoked", {
    invite_id: inviteId,
  });
  revalidatePath(TEAM_PATH);
  return { ok: true };
}

export type ResendInviteResult =
  | { ok: true; emailSent: boolean }
  | {
      ok: false;
      error: "no_session" | "owner_only" | "not_found" | "update_failed";
    };

// Owner-only. Re-sends a pending invite. Because only the token's hash is
// stored, resending mints a NEW token (the previous link stops working) and
// extends the expiry by 7 days.
export async function resendInvite(
  inviteId: string,
): Promise<ResendInviteResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (user.role !== "owner") return { ok: false, error: "owner_only" };

  const admin = getServiceRoleSupabase();
  const { data: invite } = await admin
    .from("firm_invites")
    .select("id, email, accepted_at, revoked_at")
    .eq("id", inviteId)
    .eq("firm_id", firm.id)
    .maybeSingle();
  if (!invite || invite.accepted_at || invite.revoked_at) {
    return { ok: false, error: "not_found" };
  }

  const rawToken = generateInviteToken();
  const locale = firm.locale_default ?? user.locale;
  const { error: updErr } = await admin
    .from("firm_invites")
    .update({
      token_hash: hashInviteToken(rawToken),
      expires_at: inviteExpiryISO(),
    })
    .eq("id", inviteId)
    .eq("firm_id", firm.id)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (updErr) {
    console.error("[team] resendInvite update failed:", updErr.message);
    return { ok: false, error: "update_failed" };
  }

  const email_ = buildTeamInviteEmail({
    firmName: firm.name,
    inviterName: userDisplayLabel(user),
    acceptUrl: inviteAcceptUrl(appUrl(), locale, rawToken),
    locale,
  });
  const send = await sendEmail({
    to: invite.email as string,
    subject: email_.subject,
    html: email_.html,
    text: email_.text,
  });

  await logUserActivity(firm.id, null, "invite_resent", {
    invite_id: inviteId,
  });
  revalidatePath(TEAM_PATH);
  return { ok: true, emailSent: send.sent };
}
