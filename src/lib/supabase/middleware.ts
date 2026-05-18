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
            response.cookies.set(name, value, options);
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
