"use server";

// Owner-only teammate-invitation actions. All writes use the service-role
// client (firm_invites is locked to service-role writes by migration 0190);
// the owner check is the gate. Each action returns a small result object whose
// `error` code the UI (Phase 6) maps to a friendly bilingual message.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  getServiceRoleSupabase,
  getServerSupabase,
} from "@/lib/supabase/server";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { logUserActivity } from "@/lib/db/activity";
import { getPathname } from "@/i18n/navigation";
import { checkRateLimit, SIGNUP_LIMIT } from "@/lib/rate-limit";
import {
  assertCanAddSeat,
  getFirmSeatUsage,
  hasRoomForMember,
  SeatLimitError,
} from "@/lib/billing/seats";
import { sendEmail, buildTeamInviteEmail } from "@/lib/email";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiryISO,
  inviteAcceptUrl,
  parseInviteEmail,
  parseAcceptInput,
  resolveInviteAccess,
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

// --- Accept flow (public — gated by the token, not by an owner check) --------

async function clientIp(): Promise<string> {
  const h = await headers();
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

function localPath(locale: "fr" | "en", pathname: string): string {
  return getPathname({ locale, href: pathname });
}

export type AcceptInviteState = {
  // Top-level error code (maps to InviteAccept.errors.* in the UI). Mirrors the
  // page-level InviteAccess reasons plus the form/security ones.
  error?:
    | "not_found"
    | "expired"
    | "accepted"
    | "revoked"
    | "seat_full"
    | "email_exists"
    | "create_failed"
    | "rate_limited"
    | "invalid";
  // Per-field validation (name / password / confirm).
  fieldErrors?: Record<string, string>;
} | null;

// An invited person submits their account details. Re-validates everything
// server-side (token, state, seat, email), creates a confirmed staff account in
// the invite's firm, signs them in, and lands them on the dashboard. On a valid
// submit this never returns — it redirects.
export async function acceptInvite(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const ip = await clientIp();
  const rl = await checkRateLimit({
    key: `invite-accept:ip:${ip}`,
    ...SIGNUP_LIMIT,
  });
  if (!rl.ok) return { error: "rate_limited" };

  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "invalid" };

  const parsed = parseAcceptInput({
    name: formData.get("name"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
    locale: formData.get("locale") ?? "fr",
  });
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };
  const { name, password, locale } = parsed.data;

  const admin = getServiceRoleSupabase();

  // Look up by token hash; re-run the same access decision the page used.
  const { data: invite } = await admin
    .from("firm_invites")
    .select("id, firm_id, email, accepted_at, revoked_at, expires_at")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  const usage = invite ? await getFirmSeatUsage(invite.firm_id) : null;
  const access = resolveInviteAccess(
    invite ?? null,
    usage ? hasRoomForMember(usage) : false,
  );
  if (access !== "ok" || !invite) {
    return { error: access === "ok" ? "not_found" : access };
  }

  // Re-check the email isn't already a Vylan account (someone may have signed
  // up between invite + accept). createUser is also a backstop — auth emails
  // are unique — but this returns the clean error first.
  const { data: existingUser } = await admin
    .from("users")
    .select("id")
    .eq("email", invite.email)
    .maybeSingle();
  if (existingUser) return { error: "email_exists" };

  // Create an already-confirmed auth user: the invite link proves control of
  // the email, so there is no second confirmation step.
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email: invite.email as string,
      password,
      email_confirm: true,
      user_metadata: { name, locale },
    });
  if (createErr || !created?.user) {
    const msg = (createErr?.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      return { error: "email_exists" };
    }
    console.error("[team] acceptInvite createUser failed:", createErr?.message);
    return { error: "create_failed" };
  }
  const newUserId = created.user.id;

  // Insert the public.users profile (staff, in the invite's firm).
  const { error: profileErr } = await admin.from("users").insert({
    id: newUserId,
    firm_id: invite.firm_id,
    email: invite.email,
    name,
    role: "staff",
    locale,
  });
  if (profileErr) {
    // Orphan recovery: roll the auth user back so a retry can succeed.
    console.error(
      "[team] acceptInvite profile insert failed; deleting auth user:",
      profileErr.message,
    );
    await admin.auth.admin.deleteUser(newUserId).catch(() => {});
    return { error: "create_failed" };
  }

  // Mark the invite accepted (guarded; auth email-uniqueness already prevents
  // a double-accept from creating two accounts, so this is best-effort).
  await admin
    .from("firm_invites")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by_user_id: newUserId,
    })
    .eq("id", invite.id)
    .is("accepted_at", null);

  // Log via the service-role client — the new user isn't signed in yet, so the
  // authed logUserActivity (RLS-scoped) can't write here.
  await admin.from("activity_log").insert({
    firm_id: invite.firm_id,
    engagement_id: null,
    actor_type: "user",
    actor_id: newUserId,
    action: "invite_accepted",
    metadata: { invite_id: invite.id },
  });

  // Sign them in (sets the session cookies), then land on the dashboard.
  const supabase = await getServerSupabase();
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: invite.email as string,
    password,
  });
  if (signInErr) {
    // The account exists + is confirmed; if sign-in hiccups, send them to login.
    console.error("[team] acceptInvite sign-in failed:", signInErr.message);
    redirect(localPath(locale, "/login"));
  }
  redirect(localPath(locale, "/dashboard"));
}
