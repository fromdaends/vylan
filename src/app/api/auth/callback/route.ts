import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { sendWelcomeOnce } from "@/lib/welcome";

// Handles all Supabase auth callbacks that funnel through PKCE code
// exchange:
//   * email confirmation links (signup confirm)
//   * password reset links
//   * magic links (if we ever enable them)
//   * OAuth (Google today, potentially others later)
//
// The `?next=` query param is locale-aware (e.g. "/fr/dashboard") and
// strictly validated as a same-origin pathname before we'll honour it.
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Reject anything that isn't a same-origin pathname. Block protocol-relative
  // (//evil.com), schemes (javascript:, data:, https:), and backslashes that
  // some browsers normalize to forward slashes.
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

// Pull the locale prefix off `next` so the error redirect (and the
// new-user → /demo redirect) lands on the right localized page rather
// than the unprefixed default.
function localeFromNext(next: string): "fr" | "en" {
  if (next.startsWith("/en/") || next === "/en") return "en";
  return "fr";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));
  // Same allowlist trick used by /signup + signupAction: an explicit
  // ?continue=onboarding flag means the OAuth user already qualified
  // via /demo's "Try the demo" CTA, so we skip the new-user → /demo
  // bounce and honour `next` (which the action sets to /onboarding
  // in that case).
  const continueOnboarding = searchParams.get("continue") === "onboarding";

  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      const locale = localeFromNext(next);

      if (authUser) {
        // Detect "brand new" by checking whether a public.users row exists
        // for this auth user — email signup creates that row in step1Action,
        // so it's the canonical "have they set up their firm yet" signal.
        // Google OAuth creates only an auth.users row, so first-time Google
        // users land here without one. We use this single lookup for both the
        // welcome email and the /demo funnel routing below.
        const { data: row } = await supabase
          .from("users")
          .select("id")
          .eq("id", authUser.id)
          .maybeSingle();
        const hasUsersRow = !!row;

        // Welcome the user the instant they first land signed-in — even if
        // they never finish onboarding. Self-gating (brand-new + not a reset
        // + not already welcomed), deduped, and fully deferred via after(),
        // so it never blocks or breaks this redirect.
        sendWelcomeOnce({
          authUser,
          hasUsersRow,
          isPasswordReset: next.includes("/reset-password"),
          fallbackLocale: locale,
          appUrl: origin,
        });

        // Funnel discipline: every brand-new account goes through the /demo
        // qualification questionnaire before reaching the app. The
        // `continueOnboarding` flag short-circuits this for users who came
        // from /demo's "Try the demo" CTA — they already qualified. Existing
        // users (email confirm, password reset, returning OAuth) already have
        // a public.users row → honor the requested `next`.
        if (!hasUsersRow && !continueOnboarding) {
          return NextResponse.redirect(`${origin}/${locale}/demo`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
    // Exchange failed — log WHY so "invalid or expired link" is debuggable in
    // prod. The usual culprit is the PKCE flow: the code_verifier cookie is
    // bound to the browser/tab that started signup, so opening the link
    // anywhere else (or after an email scanner pre-fetched the one-time link)
    // fails here. The robust fix is the token_hash flow (/api/auth/confirm).
    console.error("[auth/callback] exchangeCodeForSession failed", {
      message: error.message,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      next,
    });
  } else {
    console.error("[auth/callback] no `code` param in callback URL", { next });
  }
  const locale = localeFromNext(next);
  return NextResponse.redirect(`${origin}/${locale}/login?error=callback`);
}
