// One-time "Welcome to Vylan" email, sent the moment a brand-new user first
// lands signed-in — right after they click their email-confirmation link or
// finish their first Google sign-in (see the auth callback route). This used
// to fire only at the END of onboarding, so anyone who created an account but
// abandoned setup never got welcomed. Firing it here closes that gap.
//
// "Brand new" is detected by the absence of a public.users row: that row is
// created during onboarding (step 1), so its absence means the account exists
// but hasn't set up a firm yet. We dedupe with a `welcomed_at` marker written
// into the auth user's metadata, so a user only ever gets one welcome no
// matter how many times they pass back through the callback.

import { after } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { buildWelcomeEmail, sendEmail } from "@/lib/email";

type AuthLocale = "fr" | "en";

// Minimal structural shape of the Supabase auth user we need. Kept local (vs.
// importing the SDK's `User`) so this module stays easy to unit-test and
// doesn't pin to the exact SDK type.
type AuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

// PURE decision: should this auth-callback landing trigger the welcome email?
// Exported for tests. The rules, in order:
//   * no email to send to            → no
//   * password-reset landing         → no (existing user resetting access)
//   * already has a firm/profile row → no (returning user, not a new signup)
//   * already welcomed once          → no (dedupe)
export function shouldSendWelcome(input: {
  hasEmail: boolean;
  isPasswordReset: boolean;
  hasUsersRow: boolean;
  alreadyWelcomed: boolean;
}): boolean {
  if (!input.hasEmail) return false;
  if (input.isPasswordReset) return false;
  if (input.hasUsersRow) return false;
  if (input.alreadyWelcomed) return false;
  return true;
}

// Schedule the one-time welcome email for a freshly-landed user. Returns
// immediately; the marker write + email send are deferred via after() so they
// never add latency to — or fail — the auth redirect. Safe to call on every
// successful callback: it self-gates via shouldSendWelcome().
export function sendWelcomeOnce(opts: {
  authUser: AuthUserLike;
  hasUsersRow: boolean;
  isPasswordReset: boolean;
  fallbackLocale: AuthLocale;
  appUrl: string;
}): void {
  const { authUser, hasUsersRow, isPasswordReset, fallbackLocale, appUrl } =
    opts;
  const meta = authUser.user_metadata ?? {};
  const email = (authUser.email ?? "").trim();
  const alreadyWelcomed =
    typeof meta.welcomed_at === "string" && meta.welcomed_at.length > 0;

  if (
    !shouldSendWelcome({
      hasEmail: email.length > 0,
      isPasswordReset,
      hasUsersRow,
      alreadyWelcomed,
    })
  ) {
    return;
  }

  // Locale: the user picked one at email signup (stored in metadata). Google
  // users have no such metadata, so fall back to the locale of the page they
  // were heading to.
  const metaLocale = meta.locale;
  const locale: AuthLocale =
    metaLocale === "en" || metaLocale === "fr" ? metaLocale : fallbackLocale;
  const ownerName =
    (typeof meta.name === "string" && meta.name.trim()) || email.split("@")[0];

  // firmName is unused by the welcome template (no firm exists yet at this
  // point anyway); pass an empty string to satisfy the signature.
  const { subject, html, text } = buildWelcomeEmail({
    firmName: "",
    ownerName,
    appUrl,
    locale,
  });

  after(async () => {
    // Mark first so a duplicate landing can't double-send. Uses the
    // service-role client (no session cookies) so it's safe to run after the
    // response has already been sent.
    try {
      const admin = getServiceRoleSupabase();
      await admin.auth.admin.updateUserById(authUser.id, {
        user_metadata: { ...meta, welcomed_at: new Date().toISOString() },
      });
    } catch (e) {
      console.error("[welcome email] could not set welcomed_at marker:", e);
    }
    try {
      await sendEmail({ to: email, subject, html, text });
    } catch (e) {
      console.error("[welcome email] send failed:", e);
    }
  });
}
