"use server";

// Pin / unpin a firm on the founders' watchlist.
//
// ⚠️ THE ONLY WRITE THE FOUNDERS CONSOLE HAS. Everything else there reads. So
// the guard matters more here than anywhere else in that feature:
//
//   1. getFounderUser() is re-checked ON EVERY CALL. A server action is a public
//      HTTP endpoint — the page having rendered the button is not evidence the
//      caller is allowed to press it, and anyone who can read the JS bundle can
//      find this action's id. The env allowlist is the gate, again, here.
//   2. The action takes a firm id and a boolean. Nothing else. There is no code
//      path from this file to a firm's own data.
//   3. The table is unreachable by `authenticated` at all (1810: RLS on, zero
//      policies), so even a bug in point 1 does not hand anyone the ability to
//      write it through PostgREST directly.
//
// This module exports async functions ONLY — a "use server" module with a sync
// export typechecks, lints, passes every test, and then fails the production
// build naming something unrelated.

import { getFounderUser } from "@/lib/founders/access";
import { setPinned } from "@/lib/founders/pins";
import { revalidateAllLocales } from "@/lib/revalidate";

export type PinActionResult = {
  ok: boolean;
  /** The state the firm is in AFTER the call — what the button should show. */
  pinned?: boolean;
  /** Set when migration 1810 has not been applied yet. */
  needsMigration?: boolean;
  error?: "not_founder" | "bad_input" | "failed";
};

export async function toggleFirmPinAction(
  firmId: string,
  pinned: boolean,
): Promise<PinActionResult> {
  const user = await getFounderUser();
  // Deliberately the same answer for "signed out" and "not on the allowlist" —
  // this endpoint should not help anyone work out which of the two they are.
  if (!user) return { ok: false, error: "not_founder" };

  if (typeof firmId !== "string" || !firmId.trim()) {
    return { ok: false, error: "bad_input" };
  }

  const result = await setPinned(firmId.trim(), pinned === true, user.id);
  if (!result.ok) {
    return result.reason === "unavailable"
      ? { ok: false, needsMigration: true, error: "failed" }
      : { ok: false, error: "failed" };
  }

  // Both console surfaces show pins, so both have to be re-rendered — the
  // Overview's Tracking panel and the Firms table. localizedPath handles the
  // "English has no /en prefix" trap that used to make revalidation silently
  // miss for every English user.
  revalidateAllLocales("/founders");
  revalidateAllLocales(`/founders/firms/${firmId}`);

  return { ok: true, pinned: result.pinned };
}
