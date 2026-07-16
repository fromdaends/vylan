// Accent / ligature / case folding for in-browser text search.
//
// A French help center that can't find "sécurité" when you type "securite" is
// broken, and nobody types accents into a search box. This is the shared home
// for that folding.
//
// NOTE: an identical normalizeText lives in
// src/components/clients/client-archive/archive-filter.ts. That copy came
// first and is deliberately left alone here (it belongs to another session's
// locked file). Point it at this module when convenient — the behaviour is
// intentionally identical, and there are tests on both sides.

// Combining diacritical marks (U+0300-U+036F) plus the precomposed French
// ligatures oe (U+0153) and ae (U+00E6), built with escapes so this file stays
// plain ASCII and unambiguous. NFKD does not decompose oe/ae, so they are
// mapped explicitly.
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
const LIG_OE = new RegExp("\\u0153", "g");
const LIG_AE = new RegExp("\\u00e6", "g");

// Fold accents, ligatures, and case so a search for "releve" finds "Relevé"
// and "soeur" finds "Sœur" (French / Québec text). Lowercasing first collapses
// Œ→œ and Æ→æ so only the lowercase ligatures need mapping; NFKD then
// decomposes accents (é→e+◌́) and compatibility ligatures (ﬁ→fi) before the
// combining marks are stripped.
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(LIG_OE, "oe")
    .replace(LIG_AE, "ae")
    .normalize("NFKD")
    .replace(DIACRITICS, "");
}

// Split a query into folded terms. Every term must match somewhere for a
// record to hit (AND, not OR) — with a small corpus, "invoice lock" returning
// every article that mentions either word is noise, not help.
export function searchTerms(query: string): string[] {
  return normalizeText(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
