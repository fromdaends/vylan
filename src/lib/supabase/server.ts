import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

// Wrapped in React.cache() so the auth-aware Supabase client is built
// once per request even when multiple layouts/pages/components all
// ask for it. The Supabase SDK creates a fresh client per call by
// default, which means each call also re-derives cookie state — a
// real cost on dashboards that render many server components.
export const getServerSupabase = cache(async function _getServerSupabase() {
  const cookieStore = await cookies();
  const env = serverEnv();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // Override the SDK defaults of `httpOnly: false` and no `secure` flag.
      // Vylan never reads sb-* cookies from the browser (no caller of
      // getBrowserSupabase), so making them HttpOnly removes them from
      // the "script-writeable storage" bucket that Safari's ITP and other
      // privacy heuristics can purge or cap, and slams the door on any
      // XSS that might try to exfiltrate the session. Secure: true on
      // prod matches the marker-cookie session-only path in auth.ts.
      cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll may be called from a Server Component; ignore.
          }
        },
      },
    },
  );
});

export function getServiceRoleSupabase() {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for service-role operations",
    );
  }
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
