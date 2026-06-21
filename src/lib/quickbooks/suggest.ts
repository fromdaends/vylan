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
// (Stage 4). When the mapper isn't confident it returns match=null with a
// plain-English note rather than guessing, exactly like the document matcher.

import type {
  QbNamed,
  QbAccount,
  QuickbooksLists,
} from "@/lib/quickbooks/read";
import type {
  TransactionExtraction,
  TransactionTaxLine,
} from "@/lib/ai/transaction-extract";

// A reference to one cached QuickBooks entity (its id + display name).
export type QboRef = { id: string; name: string };
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
  "ltee",
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

// Lowercase, strip accents + punctuation, collapse whitespace.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Meaningful tokens of a name: normalized, with business suffixes + leading noise
// + 1-char fragments dropped. Exported for testing.
export function nameTokens(name: string): string[] {
  const toks = normalizeName(name)
    .split(" ")
    .filter((t) => t.length >= 2 && !BUSINESS_SUFFIXES.has(t));
  // Drop a single leading noise word ("the home depot" -> "home depot"), but keep
  // it if it's the ONLY token (so "Le" alone doesn't vanish to nothing).
  if (toks.length > 1 && LEADING_NOISE.has(toks[0]!)) toks.shift();
  return toks;
}

// Fuzzy similarity of two names, 0..1. Combines token overlap (Jaccard) with
// "are all of the shorter name's tokens present in the longer" (containment), so
// "Bell" vs "Bell Canada" scores well without "Bell" matching "Taco Bell" as
// strongly. Exact normalized equality is 1. Exported for testing.
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

// Rank a cached list against a query name, preferring ACTIVE entries on ties.
// Returns the confident match (>= threshold) or null, plus the top candidates.
function bestMatches(
  query: string | null,
  list: QbNamed[] | null,
  threshold = MATCH_THRESHOLD,
): MatchField {
  if (!query || !list || list.length === 0) {
    return { match: null, confidence: 0, candidates: [] };
  }
  const scored = list
    .map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
      score: nameScore(query, r.name),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.active) - Number(a.active));

  const candidates: ScoredRef[] = scored
    .slice(0, MAX_CANDIDATES)
    .map(({ id, name, score }) => ({ id, name, score: round2(score) }));

  const top = scored[0];
  const match =
    top && top.score >= threshold ? { id: top.id, name: top.name } : null;
  return {
    match,
    confidence: match ? round2(top!.score) : 0,
    candidates,
  };
}

// ── Tax code matching ─────────────────────────────────────────────────────────

// French tax labels -> the English token QBO codes usually carry, so "TPS"/"TVQ"
// receipts still match "GST"/"QST" tax codes.
const TAX_ALIASES: Record<string, string> = {
  TPS: "GST",
  TVQ: "QST",
  TVH: "HST",
  TVP: "PST",
};

// The canonical tax token for an extracted tax line ("TPS" -> "GST").
function taxToken(t: TransactionTaxLine): string {
  const up = t.type.trim().toUpperCase();
  // Use the first known tax word found in the label, mapping FR -> EN.
  for (const word of ["GST", "HST", "QST", "PST", "VAT", "TPS", "TVQ", "TVH", "TVP"]) {
    if (up.includes(word)) return TAX_ALIASES[word] ?? word;
  }
  return up;
}

// Match the document's tax(es) against the firm's cached tax codes. When two
// taxes are present (Quebec's GST + QST), prefer a single combined code whose
// name carries BOTH tokens (e.g. "GST/QST QC - 9.975"); otherwise match the
// single tax. Conservative: a code must contain at least one tax token to match.
export function matchTaxCode(
  taxes: TransactionTaxLine[],
  taxCodes: QbNamed[] | null,
): MatchField {
  if (!taxCodes || taxCodes.length === 0 || taxes.length === 0) {
    return { match: null, confidence: 0, candidates: [] };
  }
  const wanted = [...new Set(taxes.map(taxToken))].filter(Boolean);
  if (wanted.length === 0) return { match: null, confidence: 0, candidates: [] };

  const scored = taxCodes
    .map((c) => {
      const upper = c.name.toUpperCase();
      const hits = wanted.filter((w) => upper.includes(w)).length;
      // Fraction of the wanted tokens this code covers; a code that covers all
      // (the combined GST/QST code) scores 1, a partial code scores less.
      const score = hits / wanted.length;
      return { id: c.id, name: c.name, active: c.active, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.active) - Number(a.active));

  if (scored.length === 0) return { match: null, confidence: 0, candidates: [] };

  const candidates: ScoredRef[] = scored
    .slice(0, MAX_CANDIDATES)
    .map(({ id, name, score }) => ({ id, name, score: round2(score) }));
  const top = scored[0]!;
  // A combined code that covers every wanted tax is a confident match; a code
  // covering only some of a multi-tax document is a candidate, not a pick.
  const match = top.score >= 1 ? { id: top.id, name: top.name } : null;
  return { match, confidence: match ? 1 : 0, candidates };
}

// ── Account suggestion ────────────────────────────────────────────────────────

// QBO AccountType strings that mean "this is where an expense / income posts".
function isExpenseType(t: string | null): boolean {
  const s = (t ?? "").toLowerCase();
  return (
    s.includes("expense") || s.includes("cost of goods")
  );
}
function isIncomeType(t: string | null): boolean {
  const s = (t ?? "").toLowerCase();
  return s.includes("income") || s.includes("revenue");
}

// Suggest a chart-of-accounts entry. The hard one: a receipt rarely names its
// expense category, so we filter to the right KIND of account (expense for an
// expense, income for income) and only return a confident `match` when the
// party name strongly resembles an account name (e.g. a "Telephone" account for
// a phone bill). Otherwise we list the type-appropriate candidates and leave the
// pick to the accountant — honest about what the AI can and can't infer.
export function suggestAccount(
  direction: TransactionExtraction["direction"],
  partyName: string | null,
  accounts: QbAccount[] | null,
): MatchField {
  if (!accounts || accounts.length === 0) {
    return { match: null, confidence: 0, candidates: [] };
  }
  // Narrow to the plausible account kind. When direction is unknown we can't
  // narrow, so consider all active accounts.
  const pool = accounts.filter((a) => {
    if (direction === "expense") return isExpenseType(a.accountType);
    if (direction === "income") return isIncomeType(a.accountType);
    return true;
  });
  if (pool.length === 0) return { match: null, confidence: 0, candidates: [] };

  if (!partyName) {
    // No name to go on — surface the kind-filtered accounts as candidates (score
    // 0) so the UI can offer a shortlist, but make no confident pick.
    return {
      match: null,
      confidence: 0,
      candidates: pool
        .slice(0, MAX_CANDIDATES)
        .map((a) => ({ id: a.id, name: a.name, score: 0 })),
    };
  }

  const scored = pool
    .map((a) => ({
      id: a.id,
      name: a.name,
      active: a.active,
      score: nameScore(partyName, a.name),
    }))
    .sort((a, b) => b.score - a.score || Number(b.active) - Number(a.active));

  const candidates: ScoredRef[] = scored
    .slice(0, MAX_CANDIDATES)
    .map(({ id, name, score }) => ({ id, name, score: round2(score) }));
  const top = scored[0]!;
  const match =
    top.score >= MATCH_THRESHOLD ? { id: top.id, name: top.name } : null;
  return { match, confidence: match ? round2(top.score) : 0, candidates };
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
  } else if (partyKind && partyQuery && !party.match) {
    notes.push(
      `No matching ${partyKind} found for "${partyQuery}" — pick one or add it in QuickBooks.`,
    );
  } else if (partyKind && !partyQuery) {
    notes.push(`No ${partyKind} name was read off the document.`);
  }

  const account = suggestAccount(direction, partyQuery, lists.accounts);
  if (lists.accounts === null) {
    notes.push("Your QuickBooks chart of accounts isn't loaded yet.");
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
    overallConfidence: overallReadiness(extraction, partyKind, party),
    notes,
  };
}

// A rough readiness score (0..1): blends the AI's own confidence with how many
// key fields we could actually fill (amount, a matched party, a date). Not a
// probability — just a sortable "how ready is this draft" signal for the UI.
function overallReadiness(
  extraction: TransactionExtraction,
  partyKind: PartyKind | null,
  party: MatchField,
): number {
  const filled: number[] = [];
  filled.push(extraction.total != null ? 1 : 0);
  filled.push(extraction.document_date ? 1 : 0);
  // Only count the party signal when we actually expected to match one.
  if (partyKind) filled.push(party.match ? 1 : 0);
  const readiness = filled.reduce((a, b) => a + b, 0) / filled.length;
  return round2(0.5 * extraction.confidence + 0.5 * readiness);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
