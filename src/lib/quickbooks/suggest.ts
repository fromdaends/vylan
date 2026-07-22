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
  QbItem,
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
  // The transaction date override (ISO YYYY-MM-DD). The accountant sets it when
  // the AI missed the date or read it wrong. A correct date is REQUIRED to post
  // (see draftNeedsInput) and is what lets QuickBooks auto-match the transaction
  // to the bank feed. Optional: rows resolved before this feature lack it, so the
  // effective date falls back to suggestion.date.
  date?: string | null;
  // The product/service item for an INCOME line (Invoice lines need an item, not
  // an account). Optional: rows resolved before income support lack it.
  item?: ResolvedRef | null;
  // EXPENSE payment: the accountant's override of "was this paid?" (null = use the
  // AI's read) and, when paid, the bank/credit-card account it was paid FROM (a
  // QuickBooks Purchase posts against that account). Optional: pre-Purchase rows
  // lack them.
  paid?: boolean | null;
  paymentAccount?: ResolvedRef | null;
  // EXPENSE line splitting: the accountant OPTED to split across accounts, and
  // their per-line account picks keyed by line index ("0","1",…). The client
  // sends the FULL map on each change (merge_qbo_resolved does a shallow jsonb
  // replace of this key). Absent = single line (today's behavior).
  split?: boolean | null;
  lineAccounts?: Record<string, ResolvedRef | null>;
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

// ── Learned mappings (Feature 3) ──────────────────────────────────────────────
// The firm's remembered corrections, consulted BEFORE fuzzy matching. Keyed by
// signal, then by the normalized source key. Loaded from the DB by the caller and
// passed into buildTransactionSuggestion; `{}` = no learning (pre-migration, or a
// firm that hasn't corrected anything yet) so matching behaves exactly as before.
export type LearnSignal =
  | "vendor"
  | "customer"
  | "expense_account"
  | "line_account"
  | "tax";
export type LearnedRef = { id: string; name: string };
export type LearnedMappings = Partial<
  Record<LearnSignal, Record<string, LearnedRef>>
>;

// A learned overlay is very confident but deliberately < 1: exact-name identity
// (nameScore === 1) stays the only thing that scores a perfect 1.
const LEARNED_CONFIDENCE = 0.99;

// One suggested EXPENSE line for splitting a receipt across accounts: the item's
// description + its pre-tax amount, plus a suggested chart-of-accounts entry (from
// the description). The accountant confirms/overrides the account per line.
export type LineSuggestion = {
  description: string;
  amount: number; // pre-tax
  account: MatchField;
};

export type TransactionSuggestion = {
  direction: "expense" | "income" | "unknown";
  // Which cached list we searched for the other party (null when we had no name
  // or couldn't tell the direction).
  partyKind: PartyKind | null;
  party: MatchField; // the vendor (expense) or customer (income)
  account: MatchField; // suggested chart-of-accounts entry
  // For an INCOME draft: the product/service item the line posts to (derived from
  // the matched income account). Empty for expense/unknown. Optional so older
  // stored suggestions (pre-income) deserialize cleanly.
  item?: MatchField;
  taxCode: MatchField; // matched tax code
  amount: number | null; // grand total incl. tax (the headline)
  subtotal: number | null; // pre-tax
  taxTotal: number | null; // sum of the extracted tax lines (null when none)
  // EXPENSE payment: whether the receipt was already PAID (true -> posts a
  // Purchase, false/null -> a Bill), how it was paid, and a suggested bank/credit-
  // card account to post the Purchase against. All optional so older stored
  // suggestions (pre-Purchase) deserialize cleanly.
  paid?: boolean | null;
  paymentMethod?: string | null;
  paymentAccount?: MatchField; // suggested "paid from" bank/CC account
  // EXPENSE line items for splitting across accounts (empty/absent = single line).
  // Populated ONLY when the extracted lines reconcile to the subtotal, so a
  // mis-read can never post a wrong total. Older stored suggestions lack it.
  lines?: LineSuggestion[];
  date: string | null;
  currency: string | null;
  // The RAW source signals this draft was built from, kept so the resolve route
  // can learn from a correction without re-reading the extraction (Feature 3):
  // partySource = the vendor/customer name read off the document; taxSource = the
  // canonical tax-token key ("GST+QST"). Optional so older stored suggestions
  // (pre-learning) deserialize cleanly — an absent value just means "don't learn".
  partySource?: string | null;
  taxSource?: string | null;
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
  return sorted.slice(0, MAX_CANDIDATES).map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    score: round2(r.score),
  }));
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

// ── Learned mapping lookup (Feature 3) ────────────────────────────────────────

// The normalized lookup key for a NAME signal (vendor / customer / account-by-
// vendor / line-by-description): the meaningful tokens joined, so "The Home Depot
// Inc." and "Home Depot" share one key. null when the name has no usable tokens
// (so we never learn/lookup an empty key). Exported for the resolve route + tests.
export function learnKeyForName(raw: string | null): string | null {
  if (!raw) return null;
  const toks = nameTokens(raw);
  return toks.length ? toks.join(" ") : null;
}

// The normalized key for a TAX signal: the canonical tax tokens the document shows
// (GST/HST/QST/PST, FR TPS/TVQ aliases folded), sorted + joined ("GST+QST"). null
// when the document shows no recognizable tax. Exported for the resolve route.
export function learnKeyForTaxes(taxes: TransactionTaxLine[]): string | null {
  const set = new Set<string>();
  for (const t of taxes) for (const tok of taxTokensFrom(t.type)) set.add(tok);
  if (set.size === 0) return null;
  return [...set].sort().join("+");
}

// Resolve a learned mapping to a CURRENT cached entity. The remembered target is
// used only if it still EXISTS and is ACTIVE in the firm's cached list (a vendor
// archived or deleted in QuickBooks falls back to fuzzy matching). Returns a
// QboRef (active) or null. This is what makes learned picks degrade safely.
function learnedMatch(
  signal: LearnSignal,
  key: string | null,
  learned: LearnedMappings,
  list: QbNamed[] | null,
): QboRef | null {
  if (!key || !list) return null;
  const ref = learned[signal]?.[key];
  if (!ref) return null;
  const row = list.find((r) => r.id === ref.id);
  if (!row || !row.active) return null;
  return { id: row.id, name: row.name, active: row.active };
}

// Overlay a learned match onto a fuzzy MatchField: the remembered pick becomes the
// confident match and is hoisted to the top of the candidates, while the fuzzy
// alternatives remain for the accountant. A no-op when there's no learned match,
// so the fuzzy result passes through untouched.
function overlayLearned(field: MatchField, learned: QboRef | null): MatchField {
  if (!learned) return field;
  const rest = field.candidates.filter((c) => c.id !== learned.id);
  return {
    match: learned,
    confidence: LEARNED_CONFIDENCE,
    candidates: [{ ...learned, score: LEARNED_CONFIDENCE }, ...rest].slice(
      0,
      MAX_CANDIDATES,
    ),
  };
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
const KNOWN_TAX_WORDS = [
  "GST",
  "HST",
  "QST",
  "PST",
  "VAT",
  "TPS",
  "TVQ",
  "TVH",
  "TVP",
];

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
  for (const t of taxes)
    for (const tok of taxTokensFrom(t.type)) wanted.add(tok);
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

  if (sorted.length === 0)
    return { match: null, confidence: 0, candidates: [] };
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

// ── Item suggestion (income) ─────────────────────────────────────────────────

// Sellable item types that can carry an income Invoice line. Category/Bundle
// items (and anything unrecognised that isn't blank) are excluded. Exported so the
// cache layer can hide non-sellable items from the picker too — QuickBooks rejects
// an Invoice line whose ItemRef points at a Category ("set up as a category
// instead of a product or service").
export function isSellableItem(t: string | null): boolean {
  const s = (t ?? "").toLowerCase();
  return (
    s === "service" || s === "noninventory" || s === "inventory" || s === ""
  );
}

// Suggest the product/service item for an INCOME line. A QuickBooks Invoice line
// references an Item, not an account — so we bridge from the matched income
// account to the item(s) whose income account is that account. Exactly one active
// such item -> confident pick; several -> candidates, no confident pick; none (or
// no account matched) -> a shortlist of sellable items for the accountant to pick.
// Expense / unknown directions don't use an item -> empty.
export function suggestItem(
  direction: TransactionExtraction["direction"],
  accountId: string | null,
  items: QbItem[] | null | undefined,
): MatchField {
  if (direction !== "income" || !items || items.length === 0) {
    return { match: null, confidence: 0, candidates: [] };
  }
  const sellable = items.filter((i) => isSellableItem(i.itemType));
  const pool = sellable.length > 0 ? sellable : items;

  const forAccount = accountId
    ? pool.filter((i) => i.incomeAccountId === accountId)
    : [];
  if (forAccount.length > 0) {
    // Confident pick must be ACTIVE and SELLABLE — never auto-pick a Category /
    // Bundle even if it's the only item on the account (an Invoice line can't
    // post to it). Such an item still appears in candidates for the accountant.
    const active = forAccount.filter(
      (i) => i.active && isSellableItem(i.itemType),
    );
    const cands = toCandidates(
      forAccount.map((i) => ({
        id: i.id,
        name: i.name,
        active: i.active,
        score: 0.9,
      })),
    );
    // One active sellable item maps to this income account -> confident pick.
    if (active.length === 1) {
      const m = active[0];
      return {
        match: { id: m.id, name: m.name, active: m.active },
        confidence: 0.9,
        candidates: cands,
      };
    }
    // Several map to it -> let the accountant choose.
    return { match: null, confidence: 0, candidates: cands };
  }

  // No account match (or no items for it) -> shortlist sellable items, active first.
  const shortlist = [...pool]
    .sort((a, b) => Number(b.active) - Number(a.active))
    .slice(0, MAX_CANDIDATES)
    .map((i) => ({ id: i.id, name: i.name, active: i.active, score: 0 }));
  return { match: null, confidence: 0, candidates: shortlist };
}

// The QuickBooks account TYPES money can be paid FROM (a Purchase posts against a
// bank or credit-card account). Matched case-insensitively.
function isPaymentAccountType(t: string | null): boolean {
  const s = (t ?? "").toLowerCase();
  return s === "bank" || s === "credit card";
}

// True when the printed payment method looks like a credit card (so we prefer a
// Credit Card account over a Bank account).
function looksLikeCard(method: string | null): boolean {
  const s = (method ?? "").toLowerCase();
  return /visa|master|amex|american express|discover|credit|card/.test(s);
}

// Suggest the "paid from" account for a PAID expense (a QuickBooks Purchase posts
// against a bank/credit-card account). Only the payment method hints at which one,
// so we narrow the bank/CC accounts by that hint and confidently pick only when
// exactly one active candidate remains; otherwise we shortlist and let the
// accountant choose. Empty for income / unpaid / unknown-paid expenses.
export function suggestPaymentAccount(
  direction: TransactionExtraction["direction"],
  paid: boolean | null,
  paymentMethod: string | null,
  accounts: QbAccount[] | null | undefined,
): MatchField {
  if (direction === "income" || paid !== true || !accounts) {
    return { match: null, confidence: 0, candidates: [] };
  }
  const payable = accounts.filter((a) => isPaymentAccountType(a.accountType));
  if (payable.length === 0)
    return { match: null, confidence: 0, candidates: [] };

  // Narrow by the payment method's hint, but never to nothing.
  const card = looksLikeCard(paymentMethod);
  const preferred = payable.filter((a) =>
    card
      ? (a.accountType ?? "").toLowerCase() === "credit card"
      : (a.accountType ?? "").toLowerCase() === "bank",
  );
  const pool = preferred.length > 0 ? preferred : payable;

  const active = pool.filter((a) => a.active);
  const cands = toCandidates(
    pool.map((a) => ({ id: a.id, name: a.name, active: a.active, score: 0.6 })),
  );
  // Exactly one active candidate of the preferred kind -> confident pick.
  if (active.length === 1) {
    const m = active[0];
    return {
      match: { id: m.id, name: m.name, active: m.active },
      confidence: 0.6,
      candidates: cands,
    };
  }
  return { match: null, confidence: 0, candidates: cands };
}

// Cents of tolerance when checking the line items reconcile to the subtotal.
export const LINE_RECONCILE_TOLERANCE = 0.02;

// Suggest per-line EXPENSE splits, but ONLY when it's safe: at least two legible
// line items whose amounts add up to the subtotal (within tolerance). Otherwise
// returns [] so the draft stays single-line (a mis-read never posts a wrong
// total). Each line gets a suggested account matched from its description.
export function suggestLines(
  direction: TransactionExtraction["direction"],
  lineItems: TransactionExtraction["line_items"],
  subtotal: number | null,
  accounts: QbAccount[] | null | undefined,
  learned: LearnedMappings = {},
): LineSuggestion[] {
  if (direction === "income") return [];
  if (!lineItems || lineItems.length < 2) return [];
  if (subtotal == null) return [];
  const sum = round2(lineItems.reduce((s, l) => s + l.amount, 0));
  if (Math.abs(sum - subtotal) > LINE_RECONCILE_TOLERANCE) return [];
  return lineItems.map((l) => {
    // A remembered per-line account (keyed by this line's description) wins over
    // the fuzzy description->account guess; otherwise the guess passes through.
    const fuzzy = suggestAccount(direction, l.description, accounts ?? null);
    const learnedRef = learnedMatch(
      "line_account",
      learnKeyForName(l.description),
      learned,
      accounts ?? null,
    );
    return {
      description: l.description,
      amount: round2(l.amount),
      account: overlayLearned(fuzzy, learnedRef),
    };
  });
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function buildTransactionSuggestion(
  extraction: TransactionExtraction,
  lists: QuickbooksLists,
  learned: LearnedMappings = {},
  // The connected product's display name, used in the human-readable notes only
  // ("Your Xero vendor list isn't loaded yet", …). Defaults to "QuickBooks" so
  // every existing caller is unchanged; the Xero path passes "Xero". Purely
  // cosmetic — matching logic, keys, and stored ids are provider-neutral.
  providerLabel: string = "QuickBooks",
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
    notes.push(
      "Couldn't tell if this is an expense or income — assumed a vendor.",
    );
  } else if (extraction.customer_name) {
    partyKind = "customer";
    partyQuery = extraction.customer_name;
    partyList = lists.customers;
    notes.push(
      "Couldn't tell if this is an expense or income — assumed a customer.",
    );
  } else {
    notes.push("Couldn't tell if this is an expense or income.");
  }

  // A remembered vendor/customer for this exact name wins over fuzzy matching.
  const partyLearned =
    partyKind === "vendor" || partyKind === "customer"
      ? learnedMatch(partyKind, learnKeyForName(partyQuery), learned, partyList)
      : null;
  const party = overlayLearned(bestMatches(partyQuery, partyList), partyLearned);
  if (partyKind && partyQuery && partyList === null) {
    notes.push(
      `Your ${providerLabel} ${partyKind} list isn't loaded yet, so we couldn't match "${partyQuery}".`,
    );
  } else if (partyKind && partyQuery && party.match) {
    if (!party.match.active) {
      notes.push(
        `"${party.match.name}" is archived in ${providerLabel} — reactivate it or pick another ${partyKind}.`,
      );
    }
  } else if (partyKind && partyQuery && party.candidates.length > 0) {
    notes.push(
      `Couldn't confidently pick a ${partyKind} for "${partyQuery}" — choose from the suggestions.`,
    );
  } else if (partyKind && partyQuery) {
    notes.push(
      `No matching ${partyKind} found for "${partyQuery}" — pick one or add it in ${providerLabel}.`,
    );
  } else if (partyKind && !partyQuery) {
    notes.push(`No ${partyKind} name was read off the document.`);
  }

  // A remembered EXPENSE account for this vendor wins over the (weak) fuzzy
  // description->account guess — this is where "generic/odd account guesses" get
  // fixed once the accountant corrects them once. Expenses only (income posts to
  // an item, not an account).
  const accountLearned =
    direction === "expense"
      ? learnedMatch(
          "expense_account",
          learnKeyForName(partyQuery),
          learned,
          lists.accounts,
        )
      : null;
  const account = overlayLearned(
    suggestAccount(direction, partyQuery, lists.accounts),
    accountLearned,
  );
  if (lists.accounts === null) {
    notes.push(`Your ${providerLabel} chart of accounts isn't loaded yet.`);
  } else if (account.match && !account.match.active) {
    notes.push(
      `"${account.match.name}" is archived in ${providerLabel} — pick an active account.`,
    );
  } else if (!account.match) {
    notes.push(
      direction === "income"
        ? "Choose an income account for this entry."
        : "Choose an expense account for this entry.",
    );
  }

  // Income lines post to a product/service ITEM (not an account). Derive it from
  // the matched income account. Empty for expense/unknown.
  const item = suggestItem(direction, account.match?.id ?? null, lists.items);
  if (direction === "income") {
    if (item.match && !item.match.active) {
      notes.push(`Item "${item.match.name}" is archived in ${providerLabel}.`);
    } else if (!item.match) {
      notes.push("Choose a product/service for this income entry.");
    }
  }

  // A remembered tax code for this document's tax set wins over token matching.
  const taxLearned = learnedMatch(
    "tax",
    learnKeyForTaxes(extraction.taxes),
    learned,
    lists.taxCodes,
  );
  const taxCode = overlayLearned(
    matchTaxCode(extraction.taxes, lists.taxCodes),
    taxLearned,
  );
  if (extraction.taxes.length > 0 && lists.taxCodes === null) {
    notes.push(`Your ${providerLabel} tax codes aren't loaded yet.`);
  } else if (
    extraction.taxes.length > 0 &&
    taxCode.match &&
    !taxCode.match.active
  ) {
    notes.push(`Tax code "${taxCode.match.name}" is archived in ${providerLabel}.`);
  } else if (extraction.taxes.length > 0 && !taxCode.match) {
    notes.push("Couldn't confidently match the tax — confirm the tax code.");
  }

  // EXPENSE payment: a paid receipt posts a QuickBooks Purchase (against a
  // bank/credit-card account); an unpaid bill posts a Bill (as before). Suggest
  // the "paid from" account when we can; flag when the accountant must choose it.
  const paymentAccount = suggestPaymentAccount(
    direction,
    extraction.paid,
    extraction.payment_method,
    lists.accounts,
  );
  if (direction !== "income" && extraction.paid === true) {
    if (!paymentAccount.match) {
      notes.push("This looks paid — choose the account it was paid from.");
    }
  }

  // Per-line splits (expenses only, only when the lines reconcile to the
  // subtotal). Empty -> the draft stays single-line.
  const lines = suggestLines(
    direction,
    extraction.line_items,
    extraction.subtotal,
    lists.accounts,
    learned,
  );

  // If any field was filled from a past correction, say so once — transparent,
  // and never a lock (the accountant can still change any field). Checks the same
  // per-line lookups suggestLines used so a learned split line also counts.
  const anyLineLearned = lines.some(
    (l, i) =>
      learnedMatch(
        "line_account",
        learnKeyForName(extraction.line_items?.[i]?.description ?? null),
        learned,
        lists.accounts,
      ) != null,
  );
  if (partyLearned || accountLearned || taxLearned || anyLineLearned) {
    notes.push(
      "Filled in from choices you've made before — change any field if it's off.",
    );
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
    notes.push(
      "Subtotal plus tax doesn't match the total — double-check the amounts.",
    );
  }

  return {
    direction,
    partyKind,
    party,
    account,
    item,
    taxCode,
    amount: extraction.total,
    subtotal: extraction.subtotal,
    taxTotal,
    paid: extraction.paid,
    paymentMethod: extraction.payment_method,
    paymentAccount,
    lines,
    date: extraction.document_date,
    currency: extraction.currency,
    partySource: partyQuery,
    taxSource: learnKeyForTaxes(extraction.taxes),
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
