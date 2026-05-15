"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { checkRateLimit, MFA_VERIFY_LIMIT } from "@/lib/rate-limit";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/mfa-recovery";
import {
  DisableMfaSchema,
  VerifyChallengeSchema,
  VerifyEnrollSchema,
  type DisableMfaResult,
  type EnrollMfaResult,
  type VerifyMfaChallengeResult,
  type VerifyMfaEnrollResult,
} from "./mfa.schema";

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export async function enrollMfaAction(): Promise<EnrollMfaResult> {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "unauth" };

  // Clean up any unverified factors from previous half-finished enrollment
  // attempts so the user gets a clean slate. A verified factor at this
  // point is unexpected (the UI shouldn't surface "Set up" then) but we
  // still skip the cleanup to avoid clobbering working MFA.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const stale = (factors?.totp ?? []).filter((f) => f.status !== "verified");
  for (const f of stale) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Relai ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) {
    console.error("[mfa] enroll failed:", error);
    return { ok: false, error: "enroll_failed" };
  }

  return {
    ok: true,
    factor_id: data.id,
    qr_code: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function verifyMfaEnrollAction(
  formData: FormData,
): Promise<VerifyMfaEnrollResult> {
  const parsed = VerifyEnrollSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "bad_code" };

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "unauth" };

  const rl = await checkRateLimit({
    key: `mfa:verify:user:${auth.user.id}`,
    ...MFA_VERIFY_LIMIT,
  });
  if (!rl.ok) return { ok: false, error: "rate_limited" };

  const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factor_id,
  });
  if (challengeErr || !challenge) {
    return { ok: false, error: "bad_code" };
  }
  const { error: verifyErr } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factor_id,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyErr) {
    return { ok: false, error: "bad_code" };
  }

  // Generate recovery codes, hash, and store via service role (RLS only
  // allows the user to SELECT their own rows — inserts go through the
  // privileged client so the rate-limited action stays the only path).
  const plain = generateRecoveryCodes();
  const rows = plain.map((code) => ({
    user_id: auth.user!.id,
    code_hash: hashRecoveryCode(code, auth.user!.id),
  }));
  const sb = getServiceRoleSupabase();
  // Replace any stale recovery codes from a previous enrollment.
  await sb
    .from("user_mfa_recovery_codes")
    .delete()
    .eq("user_id", auth.user.id);
  const { error: insertErr } = await sb
    .from("user_mfa_recovery_codes")
    .insert(rows);
  if (insertErr) {
    console.error("[mfa] recovery insert failed:", insertErr);
    return { ok: false, error: "save_failed" };
  }

  revalidatePath("/", "layout");
  return { ok: true, recovery_codes: plain };
}

export async function disableMfaAction(
  formData: FormData,
): Promise<DisableMfaResult> {
  const parsed = DisableMfaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "wrong_password" };

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || !auth.user.email) return { ok: false, error: "unauth" };

  const rl = await checkRateLimit({
    key: `mfa:disable:user:${auth.user.id}`,
    ...MFA_VERIFY_LIMIT,
  });
  if (!rl.ok) return { ok: false, error: "rate_limited" };

  // Re-verify the password before destroying MFA so a hijacked aal2
  // session can't silently downgrade itself.
  const { error: pwErr } = await supabase.auth.signInWithPassword({
    email: auth.user.email,
    password: parsed.data.password,
  });
  if (pwErr) return { ok: false, error: "wrong_password" };

  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.totp ?? []) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) {
      console.error("[mfa] unenroll failed:", error);
      return { ok: false, error: "disable_failed" };
    }
  }

  // Service role so RLS doesn't block the delete (we don't grant DELETE
  // to authenticated on user_mfa_recovery_codes).
  const sb = getServiceRoleSupabase();
  await sb
    .from("user_mfa_recovery_codes")
    .delete()
    .eq("user_id", auth.user.id);

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function verifyMfaChallengeAction(
  formData: FormData,
): Promise<VerifyMfaChallengeResult> {
  const parsed = VerifyChallengeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "bad_code" };

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "unauth" };

  const ip = await clientIp();
  const rl = await checkRateLimit({
    key: `mfa:challenge:user:${auth.user.id}:ip:${ip}`,
    ...MFA_VERIFY_LIMIT,
  });
  if (!rl.ok) return { ok: false, error: "rate_limited" };

  if (looksLikeRecoveryCode(parsed.data.code)) {
    return await tryRecoveryCode(auth.user.id, parsed.data.code);
  }

  // Fall through: treat as TOTP. The 6-digit shape is enforced by
  // the Supabase verify endpoint — wrong-shape codes return bad_code.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = (factors?.totp ?? []).find((f) => f.status === "verified");
  if (!factor) return { ok: false, error: "no_factor" };

  const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeErr || !challenge) return { ok: false, error: "bad_code" };

  const { error: verifyErr } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (verifyErr) return { ok: false, error: "bad_code" };

  revalidatePath("/", "layout");
  return { ok: true, recovery_used: false };
}

async function tryRecoveryCode(
  userId: string,
  rawCode: string,
): Promise<VerifyMfaChallengeResult> {
  const sb = getServiceRoleSupabase();
  const hash = hashRecoveryCode(rawCode, userId);
  const { data: row } = await sb
    .from("user_mfa_recovery_codes")
    .select("id, used_at")
    .eq("user_id", userId)
    .eq("code_hash", hash)
    .is("used_at", null)
    .maybeSingle();

  if (!row) {
    return { ok: false, error: "bad_code" };
  }

  // Mark this code used.
  await sb
    .from("user_mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id);

  // Recovery flow tears MFA down so the user can sign in (they no longer
  // have access to their authenticator). They'll be prompted to re-enroll
  // from /profile after landing in the app.
  const supabase = await getServerSupabase();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.totp ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  await sb
    .from("user_mfa_recovery_codes")
    .delete()
    .eq("user_id", userId);

  revalidatePath("/", "layout");
  // We intentionally use normalizeRecoveryCode only for hashing; the
  // returned signal is just "yes, recovery path was used."
  void normalizeRecoveryCode(rawCode);
  return { ok: true, recovery_used: true };
}
