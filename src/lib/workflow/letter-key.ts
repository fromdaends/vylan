// What an automated engagement letter COVERS, as a comparable key.
//
// The spec's duplicate guard: "if a signed engagement letter already exists
// for this client covering the same service and year (e.g., signed during
// onboarding), skip the send and audit-log the skip."
//
// Answering that needs a key, and the key has to survive two awkward facts
// about the real data:
//
//  1. engagements.type is a WEAK label — four fixed values, and most real
//     rows read 'custom' (six of the founder's first ten). Keying on it alone
//     would be precise in theory and mush in practice.
//  2. Plenty of engagements have no tax year at all. Monthly bookkeeping is
//     the important case: twelve occurrences a year, and without a year
//     fallback each one would ask the client to sign the same letter again.
//
// So: `<type>:<year>`, where year is the engagement's tax year when it has
// one and otherwise the calendar year it was created in. The effect on a firm
// that never sets types is dedupe per client per year — the conservative,
// client-friendly reading. A firm that does use types gets the finer answer.
//
// PURE, so the rule is provable and the guard can be argued about in a test
// rather than in production.

import type { EngagementType } from "@/lib/db/templates";

export type LetterKeyFacts = {
  type: EngagementType | string | null | undefined;
  /** engagements.tax_year — the authoritative "which year is this for". */
  taxYear?: number | null;
  /** ISO instant the engagement was created; the year fallback. */
  createdAt?: string | null;
};

const KNOWN_TYPES = new Set(["t1", "t2", "bookkeeping", "custom"]);

/**
 * The key an automated letter is stamped with, and compared by.
 *
 * Returns null when there is nothing honest to key on (no usable year at
 * all). A null key means "do not dedupe": the letter goes out. That direction
 * is deliberate — the cost of a second signature request is an annoyed
 * client, and the cost of wrongly skipping is a firm doing work with no
 * signed engagement letter, which is the thing the letter exists to prevent.
 */
export function engagementLetterKey(f: LetterKeyFacts): string | null {
  const type =
    typeof f.type === "string" && KNOWN_TYPES.has(f.type) ? f.type : "custom";

  let year: number | null = null;
  if (typeof f.taxYear === "number" && Number.isFinite(f.taxYear)) {
    year = Math.trunc(f.taxYear);
  } else if (f.createdAt) {
    const parsed = new Date(f.createdAt);
    if (!Number.isNaN(parsed.getTime())) year = parsed.getUTCFullYear();
  }
  if (year === null) return null;

  return `${type}:${year}`;
}
