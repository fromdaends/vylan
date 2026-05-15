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
