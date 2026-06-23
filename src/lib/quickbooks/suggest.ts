// QuickBooks Stage 3, Phase 2 — the mapping "brain".
//
// A PURE, side-effect-free mapper (like ai/matching.ts). It takes what the AI
// READ off a receipt/invoice (the Phase-1 TransactionExtraction) plus the firm's
// cached QuickBooks reference lists (Stage 2), and proposes a DRAFT entry:
//   * the vendor (for an expense) or customer (for income), fuzzy-matched by name
//   * a suggested chart-of-accounts entry (best-effort; usually the accountant's call)
//   * the matched tax code (GST/HST/QST/PST, including Quebec's combined codes)
//   * the amount, subtotal, tax total, date, currency carried through
//
// It NEVER decides and NEVER writes — to QuickBooks or to our DB. Every field is
// a confidence-scored SUGGESTION the accountant confirms or overrides later
// (Stage 4). When the mapper isn't confident — no match, or two candidates too
// close to call — it returns match=null with a plain-English note rather than
// guessing, exactly like the document matcher. Archived (inactive) QuickBooks
// entities are still eligible (the read layer loads them on purpose) but the
// `active` flag is carried through every ref so the UI can warn the accountant.

import type {
  QbNamed,
  QbAccount,
  QuickbooksLists,
} from "@/lib/quickbooks/read";
import type {
  TransactionExtraction,
  TransactionTaxLine,
} from "@/lib/ai/transaction-extract";

// The accountant's chosen mapping (Stage 4), stored SEPARATELY from the AI
// suggestion so editing and Refresh (which regenerates the suggestion) never
// clobber each other. A null field means "not chosen yet" — the effective value
// then falls back to the AI match.
export type ResolvedRef = { id: string; name: string };
export type ResolvedEntry = {
  party: ResolvedRef | null;
  account: ResolvedRef | null;
  taxCode: ResolvedRef | null;
};

// A reference to one cached QuickBooks entity. `active` is carried so the
// approval UI can warn when a confident match is archived in QuickBooks.
export type QboRef = { id: string; name: string; active: boolean };
// A candidate the accountant could pick instead, with how well it scored (0..1).
export type ScoredRef = QboRef & { score: number };

// One proposed mapping field. `match` is the confident pick (or null when the
// mapper isn't sure); `candidates` are ranked alternatives for the UI's picker.
export type MatchField = {
  match: QboRef | null;
  confidence: number; // 0..1; 0 when there's no match
  candidates: ScoredRef[];
};

export type PartyKind = "vendor" | "customer";

export type TransactionSuggestion = {
  direction: "expense" | "income" | "unknown";
  // Which cached list we searched for the other party (null when we had no name
  // or couldn't tell the direction).
  partyKind: PartyKind | null;
  party: MatchField; // the vendor (expense) or customer (income)
  account: MatchField; // suggested chart-of-accounts entry
  taxCode: MatchField; // matched tax code
  amount: number | null; // grand total incl. tax (the headline)
  subtotal: number | null; // pre-tax
  taxTotal: number | null; // sum of the extracted tax lines (null when none)
  date: string | null;
  currency: string | null;
  // A rough 0..1 readiness score: how complete + confident this draft is. NOT a
  // precise probability — just a blend of the AI's own confidence and how many
  // key fields we could fill, so the UI can sort/flag drafts.
  overallConfidence: number;
  // Plain-English caveats for the accountant (e.g. "No matching vendor", "Amounts
  // in USD", "Couldn't tell if this is an expense or income").
  notes: string[];
};

// Below this score we treat a fuzzy match as "not sure" and return match=null
// (still listing candidates). Mirrors the conservative bar in ai/matching.ts.
export const MATCH_THRESHOLD = 0.6;
// When the top two candidates are within this margin we call it a tie and return
// match=null so the accountant disambiguates — a single-token receipt name
// ("Bell") must NOT confidently auto-pick between "Bell Canada" and "Taco Bell".
export const AMBIGUITY_MARGIN = 0.05;
const MAX_CANDIDATES = 5;

// ── Name normalization + scoring ──────────────────────────────────────────────

// Common business suffixes (EN + FR) stripped before comparing, so "Home Depot"
// matches "The Home Depot Inc." and "Plomberie Tremblay" matches "Plomberie
// Tremblay Inc.".
const BUSINESS_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "llc",
  "llp",
  "lp",
  "corp",
  "corporation",
  "co",
  "company",
  "ltee", // ltée normalizes to ltee after accent strip
  "enr",
  "srl",
  "sencrl",
  "senc",
  "plc",
  "pc",
]);

// Leading noise words that don't help identify a party.
const LEADING_NOISE = new Set(["the", "le", "la", "les", "l"]);

// Lowercase, strip accents, drop punctuation, collapse whitespace. Unicode-aware:
// non-Latin letters/digits (CJK, Cyrillic, Arabic) are KEPT, so an exact
// Chinese-named vendor still matches instead of normalizing to nothing.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // keep letters + numbers of any script
    .replace(/\s+/g, " ")
    .trim();
}

// Meaningful tokens of a name: normalized, with business suffixes + a single
// leading noise word dropped. 1-char tokens are KEPT (after punctuation is gone,
// they're real initials/letters — "A&W" -> "a w", "7-Eleven" -> "7 eleven" — not
// noise). Exported for testing.
export function nameTokens(name: string): string[] {
  const toks = normalizeName(name)
    .split(" ")
    .filter((t) => t.length >= 1 && !BUSINESS_SUFFIXES.has(t));
  // Drop a single leading noise word ("the home depot" -> "home depot"), but keep
  // it if it's the ONLY token (so "Le" alone doesn't vanish to nothing).
  if (toks.length > 1 && LEADING_NOISE.has(toks[0]!)) toks.shift();
  return toks;
}

// Fuzzy similarity of two names, 0..1. Combines token overlap (Jaccard) with
// "are all of the shorter name's tokens present in the longer" (containment), so
// "Bell" vs "Bell Canada" scores well. Exact normalized equality is 1. A
// single-token query against several multi-word names will tie (handled by the
// ambiguity margin in pickConfident, not here). Exported for testing.
export function nameScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (inter === 0) return 0;

  const union = ta.size + tb.size - inter;
  const jaccard = inter / union;
  const containment = inter / Math.min(ta.size, tb.size);
  // Average of the two: rewards full containment of the shorter name while still
  // penalizing lots of unmatched tokens on the longer one.
  return Math.min(1, 0.5 * jaccard + 0.5 * containment);
}

// A scored row: a cached entity plus its 0..1 score against the query.
type Scored = { id: string; name: string; active: boolean; score: number };

// Sort scored rows: highest score first, then ACTIVE before archived on a tie.
function byScoreThenActive(a: Scored, b: Scored): number {
  return b.score - a.score || Number(b.active) - Number(a.active);
}

// Choose the confident pick from a sorted, score-descending list, applying BOTH
// the minimum threshold AND the ambiguity margin: a clear winner only. Returns
// the ref (with its active flag) or null. Shared by every matcher below.
function pickConfident(
  sorted: Scored[],
  threshold: number,
): { match: QboRef | null; confidence: number } {
  const top = sorted[0];
  if (!top || top.score < threshold) return { match: null, confidence: 0 };
  const second = sorted[1];
  if (second && top.score - second.score < AMBIGUITY_MARGIN) {
    // Too close to call — let the accountant pick from the candidates.
    return { match: null, confidence: 0 };
  }
  return {
    match: { id: top.id, name: top.name, active: top.active },
    confidence: round2(top.score),
  };
}

function toCandidates(sorted: Scored[]): ScoredRef[] {
  return sorted
    .slice(0, MAX_CANDIDATES)
    .map((r) => ({ id: r.id, name: r.name, active: r.active, score: round2(r.score) }));
}

// Rank a cached list against a query name. Returns the confident match (clear
// winner >= threshold) or null, plus the top candidates.
function bestMatches(query: string | null, list: QbNamed[] | null): MatchField {
  if (!query || !list || list.length === 0) {
    return { match: null, confidence: 0, candidates: [] };
  }
  const sorted = list
    .map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
      score: nameScore(query, r.name),
    }))
    .filter((r) => r.score > 0)
    .sort(byScoreThenActive);

  const { match, confidence } = pickConfident(sorted, MATCH_THRESHOLD);
  return { match, confidence, candidates: toCandidates(sorted) };
}

// ── Tax code matching ─────────────────────────────────────────────────────────

// Known tax words and the French labels that alias to them, so both the
// document's tax line AND the QBO code name resolve to the same canonical token.
const TAX_ALIASES: Record<string, string> = {
  TPS: "GST",
  TVQ: "QST",
  TVH: "HST",
  TVP: "PST",
};
const KNOWN_TAX_WORDS = ["GST", "HST", "QST", "PST", "VAT", "TPS", "TVQ", "TVH", "TVP"];

// The canonical tax tokens contained in a string, matched on WORD BOUNDARIES
// (not raw substring) so "Private services" never yields "VAT" and a French
// "TPS/TVQ" code resolves to {GST, QST}. Used symmetrically on the document's
// tax label and on the QBO code name. Exported for testing.
export function taxTokensFrom(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toUpperCase().split(/[^A-Z]+/)) {
    if (!word) continue;
    if (KNOWN_TAX_WORDS.includes(word)) out.add(TAX_ALIASES[word] ?? word);
  }
  return out;
}

// Match the document's tax(es) against the firm's cached tax codes by comparing
// TOKEN SETS (Jaccard), so a code is only a confident match when its taxes EXACTLY
// equal the document's: a GST-only receipt matches the "GST" code (not the
// combined "GST/QST"), and a Quebec GST+QST receipt matches "GST/QST" (or French
// "TPS/TVQ"). Partial overlaps surface as candidates, never as a confident pick.
export function matchTaxCode(
  taxes: TransactionTaxLine[],
  taxCodes: QbNamed[] | null,
): MatchField {
  if (!taxCodes || taxCodes.length === 0 || taxes.length === 0) {
    return { match: null, confidence: 0, candidates: [] };
  }
  // Canonical tax tokens the document actually shows (junk labels contribute
  // nothing and so don't pollute the denominator).
  const wanted = new Set<string>();
  for (const t of taxes) for (const tok of taxTokensFrom(t.type)) wanted.add(tok);
  if (wanted.size === 0) return { match: null, confidence: 0, candidates: [] };

  const sorted = taxCodes
    .map((c) => {
      const codeToks = taxTokensFrom(c.name);
      let inter = 0;
      for (const w of wanted) if (codeToks.has(w)) inter++;
      const union = wanted.size + codeToks.size - inter;
      const score = union === 0 ? 0 : inter / union; // Jaccard, 1 iff sets equal
      return { id: c.id, name: c.name, active: c.active, score };
    })
    .filter((c) => c.score > 0)
    .sort(byScoreThenActive);

  if (sorted.length === 0) return { match: null, confidence: 0, candidates: [] };
  // A confident tax match requires an EXACT token-set match (Jaccard === 1).
  const { match, confidence } = pickConfident(sorted, 1);
  return { match, confidence, candidates: toCandidates(sorted) };
}

// ── Account suggestion ────────────────────────────────────────────────────────

// QBO AccountType strings that mean "this is where an expense / income posts".
function isExpenseType(t: string | null): boolean {
  const s = (t ?? "").toLowerCase();
  return s.includes("expense") || s.includes("cost of goods");
}
function isIncomeType(t: string | null): boolean {
  const s = (t ?? "").toLowerCase();
  return s.includes("income") || s.includes("revenue");
}

// Suggest a chart-of-accounts entry. The hard one: a receipt rarely names its
// expense category, so we filter to the right KIND of account (expense for an
// expense, income for income) and only return a confident `match` when the
// party name strongly resembles an account name (e.g. a "Telephone" account for
// a phone bill). Otherwise we list the type-appropriate candidates (active first)
// and leave the pick to the accountant — honest about what the AI can infer.
export function suggestAccount(
  direction: TransactionExtraction["direction"],
  partyName: string | null,
  accounts: QbAccount[] | null,
): MatchField {
  if (!accounts || accounts.length === 0) {
    return { match: null, confidence: 0, candidates: [] };
  }
  // Narrow to the plausible account kind. When direction is unknown we can't
  // narrow, so consider all accounts.
  const pool = accounts.filter((a) => {
    if (direction === "expense") return isExpenseType(a.accountType);
    if (direction === "income") return isIncomeType(a.accountType);
    return true;
  });
  if (pool.length === 0) return { match: null, confidence: 0, candidates: [] };

  if (!partyName) {
    // No name to go on — surface the kind-filtered accounts as candidates (score
    // 0, active first) so the UI can offer a shortlist, but make no confident pick.
    const shortlist = [...pool]
      .sort((a, b) => Number(b.active) - Number(a.active))
      .slice(0, MAX_CANDIDATES)
      .map((a) => ({ id: a.id, name: a.name, active: a.active, score: 0 }));
    return { match: null, confidence: 0, candidates: shortlist };
  }

  const sorted = pool
    .map((a) => ({
      id: a.id,
      name: a.name,
      active: a.active,
      score: nameScore(partyName, a.name),
    }))
    .sort(byScoreThenActive);

  const { match, confidence } = pickConfident(sorted, MATCH_THRESHOLD);
  return { match, confidence, candidates: toCandidates(sorted) };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function buildTransactionSuggestion(
  extraction: TransactionExtraction,
  lists: QuickbooksLists,
): TransactionSuggestion {
  const notes: string[] = [];
  const direction = extraction.direction;

  // Decide which list to search and with what name. For a clear direction we use
  // the matching name; when direction is unknown we fall back to whichever name
  // the AI read (vendor first, then customer).
  let partyKind: PartyKind | null = null;
  let partyQuery: string | null = null;
  let partyList: QbNamed[] | null = null;
  if (direction === "expense") {
    partyKind = "vendor";
    partyQuery = extraction.vendor_name;
    partyList = lists.vendors;
  } else if (direction === "income") {
    partyKind = "customer";
    partyQuery = extraction.customer_name;
    partyList = lists.customers;
  } else if (extraction.vendor_name) {
    partyKind = "vendor";
    partyQuery = extraction.vendor_name;
    partyList = lists.vendors;
    notes.push("Couldn't tell if this is an expense or income — assumed a vendor.");
  } else if (extraction.customer_name) {
    partyKind = "customer";
    partyQuery = extraction.customer_name;
    partyList = lists.customers;
    notes.push("Couldn't tell if this is an expense or income — assumed a customer.");
  } else {
    notes.push("Couldn't tell if this is an expense or income.");
  }

  const party = bestMatches(partyQuery, partyList);
  if (partyKind && partyQuery && partyList === null) {
    notes.push(
      `Your QuickBooks ${partyKind} list isn't loaded yet, so we couldn't match "${partyQuery}".`,
    );
  } else if (partyKind && partyQuery && party.match) {
    if (!party.match.active) {
      notes.push(
        `"${party.match.name}" is archived in QuickBooks — reactivate it or pick another ${partyKind}.`,
      );
    }
  } else if (partyKind && partyQuery && party.candidates.length > 0) {
    notes.push(
      `Couldn't confidently pick a ${partyKind} for "${partyQuery}" — choose from the suggestions.`,
    );
  } else if (partyKind && partyQuery) {
    notes.push(
      `No matching ${partyKind} found for "${partyQuery}" — pick one or add it in QuickBooks.`,
    );
  } else if (partyKind && !partyQuery) {
    notes.push(`No ${partyKind} name was read off the document.`);
  }

  const account = suggestAccount(direction, partyQuery, lists.accounts);
  if (lists.accounts === null) {
    notes.push("Your QuickBooks chart of accounts isn't loaded yet.");
  } else if (account.match && !account.match.active) {
    notes.push(
      `"${account.match.name}" is archived in QuickBooks — pick an active account.`,
    );
  } else if (!account.match) {
    notes.push(
      direction === "income"
        ? "Choose an income account for this entry."
        : "Choose an expense account for this entry.",
    );
  }

  const taxCode = matchTaxCode(extraction.taxes, lists.taxCodes);
  if (extraction.taxes.length > 0 && lists.taxCodes === null) {
    notes.push("Your QuickBooks tax codes aren't loaded yet.");
  } else if (extraction.taxes.length > 0 && taxCode.match && !taxCode.match.active) {
    notes.push(`Tax code "${taxCode.match.name}" is archived in QuickBooks.`);
  } else if (extraction.taxes.length > 0 && !taxCode.match) {
    notes.push("Couldn't confidently match the tax — confirm the tax code.");
  }

  const taxTotal =
    extraction.taxes.length > 0
      ? round2(extraction.taxes.reduce((sum, t) => sum + t.amount, 0))
      : null;

  if (extraction.currency && extraction.currency !== "CAD") {
    notes.push(`Amounts appear to be in ${extraction.currency}, not CAD.`);
  }
  if (extraction.total == null) {
    notes.push("No total amount could be read.");
  }
  // Sanity check: subtotal + taxes should be close to total.
  if (
    extraction.total != null &&
    extraction.subtotal != null &&
    taxTotal != null &&
    Math.abs(extraction.subtotal + taxTotal - extraction.total) > 0.05
  ) {
    notes.push("Subtotal plus tax doesn't match the total — double-check the amounts.");
  }

  return {
    direction,
    partyKind,
    party,
    account,
    taxCode,
    amount: extraction.total,
    subtotal: extraction.subtotal,
    taxTotal,
    date: extraction.document_date,
    currency: extraction.currency,
    overallConfidence: overallReadiness(extraction, party),
    notes,
  };
}

// A rough readiness score (0..1): blends the AI's own confidence with how many
// key fields we could actually fill (amount, date, a matched party). A missing
// party ALWAYS counts as a gap, so an unidentified document never scores higher
// than a partially-identified one. Not a probability — just a sortable signal.
function overallReadiness(
  extraction: TransactionExtraction,
  party: MatchField,
): number {
  const filled = [
    extraction.total != null ? 1 : 0,
    extraction.document_date ? 1 : 0,
    party.match ? 1 : 0,
  ];
  const readiness = filled.reduce((a, b) => a + b, 0) / filled.length;
  return round2(0.5 * extraction.confidence + 0.5 * readiness);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
