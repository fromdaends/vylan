// What an automated engagement letter COVERS, as a comparable key.
//
// The spec's duplicate guard: "if a signed engagement letter already exists
// for this client covering the same service and year (e.g., signed during
// onboarding), skip the send and audit-log the skip."
//
// Since 1700 the letter hangs off a SERVICE (firm_services), so "the same
// service" is now a literal question rather than an approximation. It used to
// be keyed on engagements.type — four fixed values, reading 'custom' on most
// real rows — which was precise in theory and mush in practice.
//
// The year still needs a fallback. Plenty of engagements carry no tax year,
// and monthly bookkeeping is the case that matters: twelve occurrences a
// year, each of which would otherwise ask the client to sign the same letter
// again. So: the tax year when there is one, else the calendar year the
// engagement was created in.
//
// PURE, so the rule is provable and the guard can be argued about in a test
// rather than in production.

export type LetterKeyFacts = {
  /** firm_services.id — which service's letter this is. */
  serviceId: string | null | undefined;
  /** engagements.tax_year — the authoritative "which year is this for". */
  taxYear?: number | null;
  /** ISO instant the engagement was created; the year fallback. */
  createdAt?: string | null;
};

/**
 * The key an automated letter is stamped with, and compared by.
 *
 * Returns null when there is nothing honest to key on — no service, or no
 * usable year. A null key means "do not dedupe": the letter goes out. That
 * direction is deliberate — the cost of a second signature request is an
 * annoyed client, and the cost of wrongly skipping is a firm doing work with
 * no signed engagement letter, which is the thing the letter exists to
 * prevent.
 */
export function engagementLetterKey(f: LetterKeyFacts): string | null {
  const serviceId =
    typeof f.serviceId === "string" && f.serviceId.trim() ? f.serviceId : null;
  if (!serviceId) return null;

  let year: number | null = null;
  if (typeof f.taxYear === "number" && Number.isFinite(f.taxYear)) {
    year = Math.trunc(f.taxYear);
  } else if (f.createdAt) {
    const parsed = new Date(f.createdAt);
    if (!Number.isNaN(parsed.getTime())) year = parsed.getUTCFullYear();
  }
  if (year === null) return null;

  return `svc:${serviceId}:${year}`;
}
