// FOUNDER ACCESS — the one gate in front of /founders.
//
// Every other page in Vylan is firm-scoped: RLS is the boundary and the worst a
// bug can do is show you a row you already had rights to. The founders console
// is the single exception — it reads ACROSS every firm on the platform with the
// service role, which means RLS is not protecting anything here. This file is.
//
// ── WHY AN ENV ALLOWLIST AND NOT A DATABASE FLAG ──────────────────────────────
//
// The founder's call, and the right one for a control of this blast radius:
//
//   1. A flag on a row can be written. An env var cannot be written by the app
//      at all — no server action, no RLS policy mistake, no compromised owner
//      account can add someone to this list. The only way in is the Vercel
//      dashboard.
//   2. It needs no migration, so it cannot be half-applied. A `is_founder`
//      column that has not been applied yet reads as `undefined`, and every
//      "undefined is falsy" habit in this codebase would then be the only thing
//      standing between a stranger and every firm's data. That is too thin.
//   3. Revoking is instant and total.
//
// ── FAIL CLOSED, ALWAYS ───────────────────────────────────────────────────────
//
// No env set ⇒ the list is EMPTY ⇒ nobody is a founder ⇒ /founders 404s for
// everyone including us. That is deliberate. There is no fallback to a support
// address, no "if it's the first user", no dev-mode bypass. An access control
// that guesses is not an access control.
//
// NOTE the deliberate 404 (notFound) rather than a 403 at the call sites: a page
// that says "you are not allowed here" has told an attacker that here exists.

import { getCurrentUser, type AppUser } from "@/lib/db/users";

/**
 * Split an allowlist string into normalised emails.
 *
 * Accepts commas, semicolons, whitespace and newlines as separators, because
 * the value is typed into a Vercel textarea by a human and "a@x.com, b@y.com"
 * and "a@x.com\nb@y.com" are both what a human means.
 *
 * Normalisation is lowercase + trim. `users.email` is `citext`, so the database
 * already treats Zach@ and zach@ as one address; the comparison here has to
 * agree with it or the gate would be case-sensitive in one direction only.
 */
export function parseFounderEmails(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

/**
 * The live allowlist, read fresh from the environment on every call.
 *
 * Two sources, unioned:
 *
 *   FOUNDER_EMAILS        the real list — add Tyler, remove anyone, one place.
 *   FOUNDER_NOTIFY_EMAIL  already set in production (it is where demo leads are
 *                         emailed, see lib/demo-notify.ts). Included so the
 *                         console is reachable the moment it deploys instead of
 *                         being dead until someone remembers to add a var.
 *
 * ⚠️ The union means whoever receives the lead emails can also open the console.
 * That is true by construction — they are the same person — but it is worth
 * knowing before FOUNDER_NOTIFY_EMAIL is ever pointed at a shared or outsourced
 * inbox. If that day comes, set FOUNDER_EMAILS and stop using the fallback.
 *
 * Deliberately NOT read through lib/env.ts: that module throws on a malformed
 * environment, and a typo in an unrelated secret must never be the reason an
 * access check answers "yes". It also keeps this out of the shared env schema,
 * which is a file other sessions edit.
 */
export function founderEmails(): string[] {
  const list = [
    ...parseFounderEmails(process.env.FOUNDER_EMAILS),
    ...parseFounderEmails(process.env.FOUNDER_NOTIFY_EMAIL),
  ];
  return [...new Set(list)];
}

/** Is this email on the allowlist? Empty list ⇒ always false. */
export function isFounderEmail(
  email: string | null | undefined,
  allowlist: readonly string[] = founderEmails(),
): boolean {
  if (!email) return false;
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

/**
 * The signed-in user IF they are a founder, else null.
 *
 * getCurrentUser is React.cache()'d, so calling this from the layout, the page
 * and a nested component costs one query per request.
 */
export async function getFounderUser(): Promise<AppUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return isFounderEmail(user.email) ? user : null;
}

/** True when nobody at all can reach the console (no env configured). */
export function founderAccessUnconfigured(): boolean {
  return founderEmails().length === 0;
}
