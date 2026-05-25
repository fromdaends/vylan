import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

// Handles all Supabase auth callbacks that funnel through PKCE code
// exchange:
//   * email confirmation links (signup confirm)
//   * password reset links
//   * magic links (if we ever enable them)
//   * OAuth (Google today, potentially others later)
//
// The `?next=` query param is locale-aware (e.g. "/fr/home") and
// strictly validated as a same-origin pathname before we'll honour it.
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/home";
  // Reject anything that isn't a same-origin pathname. Block protocol-relative
  // (//evil.com), schemes (javascript:, data:, https:), and backslashes that
  // some browsers normalize to forward slashes.
  if (!raw.startsWith("/")) return "/home";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/home";
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

  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Funnel discipline: every brand-new account must go through the
      // /demo qualification questionnaire before reaching the app. We
      // detect "brand new" by checking whether a public.users row
      // exists for this auth user — email signup creates that row in
      // step1Action, so it's the canonical "have they finished
      // onboarding their firm" signal. Google OAuth creates only an
      // auth.users row, so first-time Google users will land here
      // without a public.users row and get routed to /demo.
      //
      // Existing users (email confirm, password reset, returning OAuth)
      // already have a public.users row → honor the requested `next`.
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      const locale = localeFromNext(next);

      if (userId) {
        const { data: row } = await supabase
          .from("users")
          .select("id")
          .eq("id", userId)
          .maybeSingle();
        if (!row) {
          return NextResponse.redirect(`${origin}/${locale}/demo`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  const locale = localeFromNext(next);
  return NextResponse.redirect(`${origin}/${locale}/login?error=callback`);
}
