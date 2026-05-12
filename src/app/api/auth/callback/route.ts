import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

// Handles Supabase auth callbacks: PKCE code exchange for email confirmation
// links, magic links, password-reset links.
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Reject anything that isn't a same-origin pathname. Block protocol-relative
  // (//evil.com), schemes (javascript:, data:, https:), and backslashes that
  // some browsers normalize to forward slashes.
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
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
  return NextResponse.redirect(`${origin}/login?error=callback`);
}
