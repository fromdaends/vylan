"use client";

import { createBrowserClient } from "@supabase/ssr";

// The browser-side client. Used ONLY for Supabase Realtime (the live presence
// row on an engagement) — every read and write in this app goes through the
// server client in ./server.ts.
//
// All three auth behaviours are off deliberately. The session cookies are
// HttpOnly by design, so this client can never hold a session and has nothing
// to persist or refresh; and detectSessionInUrl would have it inspecting the
// URL of every page it is mounted under, in an app that has two real auth
// confirmation routes. Leaving the defaults on would be a GoTrue client running
// for no reason on pages that have nothing to do with auth.
export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
