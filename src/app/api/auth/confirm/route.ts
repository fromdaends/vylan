import { NextResponse, type NextRequest } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { sendWelcomeOnce } from "@/lib/welcome";

// Cross-device email confirmation.
//
// The default Supabase confirmation link uses the PKCE code flow, whose
// code_verifier cookie is bound to the browser that STARTED signup — so opening
// the link on a different device (e.g. the phone, after signing up on a laptop)
// confirms the email but can't establish a session there, leaving the user
// not-logged-in. This route instead verifies the self-contained `token_hash`
// from the email link via verifyOtp, which works on ANY device.
//
// Wired up by pointing the Supabase "Confirm signup" email template here, e.g.:
//   {{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/onboarding
//
// On success the (now signed-in) user lands on `next` — /onboarding for a fresh
// signup, localized to their account language — with no /demo funnel detour
// (this route owns its redirect, so unlike /api/auth/callback it needs no
// continue=onboarding flag).

// The OTP types we accept here, so a stray `?type=` can't be forwarded blindly.
const VALID_TYPES = new Set([
  "signup",
  "email",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
]);

function sanitizeNext(raw: string | null): string {
  // Same-origin pathname only; default to onboarding (this route is the
  // signup-confirmation entry point).
  if (!raw || !raw.startsWith("/")) return "/onboarding";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/onboarding";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const next = sanitizeNext(searchParams.get("next"));

  if (tokenHash && rawType && VALID_TYPES.has(rawType)) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.verifyOtp({
      type: rawType as EmailOtpType,
      token_hash: tokenHash,
    });
    if (!error) {
      // Land on `next`, localized to the account's language (the device that
      // opened the email may have no locale cookie, so derive it from the user
      // metadata the signup stored).
      const { data: auth } = await supabase.auth.getUser();
      const authUser = auth?.user;
      const userLocale =
        authUser?.user_metadata?.locale === "en" ? "en" : "fr";

      // Welcome the user the instant they confirm. This is the cross-device
      // signup-confirmation entry point, so for email signups it's where they
      // first land signed-in — mirrors /api/auth/callback (the PKCE / Google
      // path). The shared once-only dedupe (welcomed_at marker) means a user
      // is welcomed exactly once regardless of which route they came through.
      // `recovery` = a password reset, which never gets a welcome.
      if (authUser) {
        const { data: row } = await supabase
          .from("users")
          .select("id")
          .eq("id", authUser.id)
          .maybeSingle();
        sendWelcomeOnce({
          authUser,
          hasUsersRow: !!row,
          isPasswordReset:
            rawType === "recovery" || next.includes("/reset-password"),
          fallbackLocale: userLocale,
          appUrl: origin,
        });
      }

      const dest = /^\/(fr|en)(\/|$)/.test(next)
        ? next
        : `/${userLocale}${next}`;
      return NextResponse.redirect(`${origin}${dest}`);
    }
    // verifyOtp failed — log WHY so a bad confirmation is debuggable in prod
    // (e.g. "otp_expired" when an email scanner already consumed the one-time
    // token, or a token_hash / type mismatch).
    console.error("[auth/confirm] verifyOtp failed", {
      message: error.message,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      type: rawType,
      next,
    });
  } else {
    console.error("[auth/confirm] missing or invalid params", {
      hasTokenHash: !!tokenHash,
      type: rawType,
      next,
    });
  }

  // Bad / expired / already-used link (or another error). Send them to log in —
  // if the email did get confirmed, signing in now works.
  return NextResponse.redirect(`${origin}/fr/login?error=callback`);
}
