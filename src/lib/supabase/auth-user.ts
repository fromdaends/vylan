import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

// The ONE per-request supabase.auth.getUser() call.
//
// getUser() validates the session against the Supabase auth server over the
// network on every call — React.cache() on getServerSupabase memoizes the
// client object, NOT the call. Before this module existed, a single page
// render stacked 3-5 of those round trips (layout + getCurrentUser +
// getCurrentFirm + whichever lib/db helpers the page touched), each 30-80ms,
// all sequential with the DB reads they gate.
//
// Lives in its own module rather than server.ts on purpose: ~26 test files
// mock "@/lib/supabase/server" with a factory that only provides
// getServerSupabase, and adding an export there would leave it undefined in
// every one of those mocks. Here the helper flows through the mocked client,
// so those tests exercise it unchanged.
export const getAuthUser = cache(async function _getAuthUser(): Promise<
  User | null
> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});
