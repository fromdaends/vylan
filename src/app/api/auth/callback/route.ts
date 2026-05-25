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

// Pull the locale prefix off `next` so the error redirect lands the
// user on the right /{locale}/login page rather than the bare /login.
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
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  const locale = localeFromNext(next);
  return NextResponse.redirect(`${origin}/${locale}/login?error=callback`);
}
