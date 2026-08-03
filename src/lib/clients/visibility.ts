// How far a client is discoverable (migration 1280).
//
// A PLAIN MODULE, deliberately, and this is not tidiness. These two exports
// started life in src/lib/db/clients.ts next to the type they describe — and
// the moment a "use client" component imported the FUNCTION (not just the
// type), the whole build died with:
//
//   You're importing a module that depends on "next/headers".
//
// db/clients.ts reaches next/headers through getServerSupabase, and a type
// import is erased at compile time while a value import is not. So the value
// half lives here, where nothing server-only can follow it into a browser
// bundle. Same lesson as #796 and #958, one layer down.

export const CLIENT_VISIBILITIES = ["members", "listed"] as const;
export type ClientVisibility = (typeof CLIENT_VISIBILITIES)[number];

/**
 * Read a client's visibility, FAILING CLOSED.
 *
 * Anything absent, misspelled or unrecognised resolves to "members" — the
 * narrow state. Note this is the OPPOSITE default from is_private, which fails
 * OPEN on purpose so a transient read cannot hide a client from the person
 * working on it. The two fields sit one line apart and want opposite defaults,
 * which is exactly why each says so out loud.
 */
export function clientVisibility(
  c: { visibility?: string | null } | null | undefined,
): ClientVisibility {
  return c?.visibility === "listed" ? "listed" : "members";
}
