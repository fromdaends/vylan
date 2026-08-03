// Accent / ligature / case folding for in-browser text search.
//
// A French help center that can't find "sécurité" when you type "securite" is
// broken, and nobody types accents into a search box. This is the shared home
// for that folding.
//
// THE ONLY normalizeText. There used to be four, and two of them had drifted:
// the engagement preview and the engagement chat search used NFD without the
// oe/ae mapping, so typing "soeur" found nothing for a client named Sœur, and
// "finance" missed text carrying the ﬁ ligature that PDF extraction produces —
// on the two surfaces that search extracted document text. Accents worked
// everywhere, which is exactly why nobody noticed.
//
// Each copy also had its own tests, and all four passed: a test file asserts
// what its own copy happens to do, not what the concept is supposed to do. If
// you need folding, import it from here. Do not write a fifth.

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
// Trailing/leading whitespace is never meaningful to a match, and one of the
// copies folded into here already trimmed — so trimming is the standard rather
// than something each caller remembers to do.
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(LIG_OE, "oe")
    .replace(LIG_AE, "ae")
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .trim();
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
