import { createServerClient } from "@supabase/ssr";
import { type NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session against the provided response. Any
// auth cookies the SDK rotates (access token, refresh token, code
// verifier) land on the response the caller is about to return —
// nothing to merge afterwards.
//
// Two-write pattern from the Supabase docs:
//   * request.cookies.set(...) so subsequent reads in the same request
//     see the fresh value (matters when downstream code re-creates a
//     Supabase client off this same request).
//   * response.cookies.set(name, value, options) so the browser
//     actually stores the rotated cookie with its full attribute set
//     (path, sameSite, secure, expires) — losing those is the most
//     common reason "I'm signed in here but a new tab forgets me".
export async function updateSupabaseSession(
  request: NextRequest,
  response: NextResponse,
) {
  // "Remember me" preference. The login action drops this marker
  // cookie when the user unticks the box; we honour it on every
  // token rotation by stripping maxAge / expires from outgoing
  // sb-* cookies so they stay session-only. Without this, the SDK's
  // persistent default would creep back in on the next refresh and
  // the browser would keep the session past close.
  const sessionOnly =
    request.cookies.get("vylan-session-only")?.value === "1";

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            let opts = options;
            if (sessionOnly && name.startsWith("sb-")) {
              opts = { ...options };
              delete opts.maxAge;
              delete opts.expires;
            }
            response.cookies.set(name, value, opts);
          }
        },
      },
    },
  );

  // getUser() is what triggers the refresh-token rotation when the
  // access token is close to expiry. Without this call the cookies
  // never get rotated and the session decays silently.
  await supabase.auth.getUser();
}
