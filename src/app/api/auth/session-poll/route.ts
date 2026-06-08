import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

// Lightweight poll for the "check your email" screen. When the user confirms
// their email IN THE SAME BROWSER, the confirmation link opens a tab that sets
// the session cookie — which is shared across all tabs of that browser. This
// endpoint reads that cookie server-side and reports whether a session now
// exists, so the original signup tab can detect it and advance into the app
// automatically (no manual reload).
//
// Note: this only fires for same-browser confirmation. Confirming on a
// genuinely different device/browser can't be auto-detected here (no session
// on the original device) — that would need a by-email lookup.
export async function GET() {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return NextResponse.json(
    { loggedIn: !!data.user },
    { headers: { "Cache-Control": "no-store" } },
  );
}
