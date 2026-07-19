// Auto-link a connected QuickBooks company to a Vylan client by name (Phase 3a).
//
// The founder's rule: when a QuickBooks company's name EXACTLY matches a Vylan
// client's name, link them automatically so the accountant never has to pick the
// client by hand. We compare on a normalized form (trim + lowercase + collapse
// inner whitespace) but nothing fuzzier — a wrong auto-link would route one
// client's books to the wrong company, so anything short of a single unambiguous
// exact match falls back to a manual pick (returns null).

export type LinkableClient = { id: string; name: string };

// Normalize a name for comparison: trim, lowercase, collapse internal whitespace.
// Deliberately conservative — no suffix stripping ("Inc"/"Ltd") or accent folding,
// because a false match is worse than a manual pick here.
export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// The single client whose name exactly matches the company name (after
// normalization), or null when there is NO match or MORE THAN ONE (ambiguous →
// the owner picks manually; we never guess which client the books belong to).
export function matchClientByCompanyName(
  companyName: string | null | undefined,
  clients: LinkableClient[],
): LinkableClient | null {
  const target = normalizeCompanyName(companyName ?? "");
  if (!target) return null;
  const matches = clients.filter(
    (c) => normalizeCompanyName(c.name) === target,
  );
  return matches.length === 1 ? matches[0]! : null;
}
