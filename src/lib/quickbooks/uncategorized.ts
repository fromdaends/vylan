// "What is sitting in this client's books that nobody has coded yet?"
//
// The second of the two backwards-running reads. The missing-receipt scan
// (receipt-gap.ts) asks which entries have no paper behind them; this one asks
// which entries have no MEANING behind them — the ones a bank feed dropped into
// Uncategorised Expense because nobody told QuickBooks what they were.
//
// That pile is the reason a month-end close drags. It is also the pile a firm
// cannot clear alone: only the client knows what the $340 at Costco was for.
//
// WHY NAMES AND NOT TYPES. QuickBooks has no flag for "this account means
// uncategorised". The four accounts it auto-creates (Uncategorised Expense,
// Uncategorised Income, Uncategorised Asset, Ask My Accountant) are ordinary
// accounts whose only distinguishing feature is the name it gave them. So this
// matches on name — and then SHOWS the firm which accounts it matched, because
// a scan that silently decides what counts as uncategorised is a scan nobody
// can check. A firm whose file uses a differently-named suspense account will
// see it was not included, which is a question they can answer; a scan that
// quietly returned nothing is one they cannot.
//
// WHAT IT CAN AND CANNOT SEE. Same wall as the receipt scan: only transactions
// already POSTED to the ledger. The bank feed's "For Review" queue is closed to
// every app, Dext and Hubdoc included (see register-match.ts). That is the right
// scope anyway — a charge nobody has accepted into the books isn't miscoded, it
// is undecided.
//
// THREE TABLES, TWO LINE SHAPES. Purchase and Bill hold expenses and name their
// account under AccountBasedExpenseLineDetail; Deposit holds money coming in and
// names it under DepositLineDetail. Deposits earn their place here: Uncategorised
// Income and Uncategorised Asset fill up from exactly one source, and a firm that
// only ever saw miscoded expenses would close a month with unexplained money in
// it.

import {
  quickbooksQuery,
  type QuickbooksEnvironment,
} from "@/lib/quickbooks/client";

// QuickBooks' /query page cap. Hitting it means the read was TRUNCATED and the
// answer is incomplete — reported rather than presented as "that's everything",
// because "nothing left to code" and "we stopped looking" must never look alike.
const MAX_ROWS = 1000;

const UNCAT_TABLES = ["Purchase", "Bill", "Deposit"] as const;
type UncatTable = (typeof UNCAT_TABLES)[number];

const ENTITY_OF: Record<UncatTable, UncatEntity> = {
  Purchase: "purchase",
  Bill: "bill",
  Deposit: "deposit",
};

export type UncatEntity = "purchase" | "bill" | "deposit";

// Which line-detail block on each table carries the account. A line that has
// neither is an item-based line — it points at a product, not an account, and
// there is nothing here to recode.
const LINE_DETAIL_KEY: Record<UncatTable, string> = {
  Purchase: "AccountBasedExpenseLineDetail",
  Bill: "AccountBasedExpenseLineDetail",
  Deposit: "DepositLineDetail",
};

export function lineDetailKeyOf(entity: UncatEntity): string {
  return entity === "deposit"
    ? "DepositLineDetail"
    : "AccountBasedExpenseLineDetail";
}

export function tableOf(entity: UncatEntity): UncatTable {
  return entity === "purchase" ? "Purchase" : entity === "bill" ? "Bill" : "Deposit";
}

// ── Which accounts count as "not coded yet" ──────────────────────────────────

// The names QuickBooks itself gives the parking accounts, across the spellings
// and languages a Canadian firm actually meets. Anchored at the START so an
// account that merely mentions the word ("Transfer from Uncategorised Asset")
// is not swept in, and matched case-insensitively because company files
// disagree about capitalisation.
//
// Deliberately NOT a fuzzy match on the word "suspense": plenty of firms keep a
// legitimate suspense account they reconcile themselves, and dragging it into a
// client-facing question list would be worse than missing it.
const UNCATEGORIZED_PATTERNS: readonly RegExp[] = [
  /^uncategori[sz]ed\b/i, // Uncategorised Expense / Income / Asset (US + UK)
  /^ask my accountant$/i, // QuickBooks' "park it and ask" account
  /^non\s*catégoris/i, // Non catégorisé — FR company files
  /^sans\s*catégorie/i, // Sans catégorie
  /^demander\s+à\s+mon\s+comptable$/i, // Ask My Accountant, FR
];

export function isUncategorizedAccountName(name: string | null): boolean {
  const n = name?.trim();
  if (!n) return false;
  return UNCATEGORIZED_PATTERNS.some((re) => re.test(n));
}

/** One account in the client's chart of accounts. */
export type LedgerAccount = {
  id: string;
  name: string;
  accountType: string | null;
  active: boolean;
};

export function rowsToAccounts(
  rows: ReadonlyArray<Record<string, unknown>>,
): LedgerAccount[] {
  const out: LedgerAccount[] = [];
  for (const r of rows) {
    const id = typeof r.Id === "string" ? r.Id : null;
    const name = typeof r.Name === "string" ? r.Name : null;
    if (!id || !name) continue;
    out.push({
      id,
      name,
      accountType: typeof r.AccountType === "string" ? r.AccountType : null,
      // QuickBooks omits Active on some reads; absent means active.
      active: r.Active !== false,
    });
  }
  return out;
}

/** The parking accounts among them — the ones this scan reads as "not coded". */
export function uncategorizedAmong(
  accounts: readonly LedgerAccount[],
): LedgerAccount[] {
  return accounts.filter((a) => isUncategorizedAccountName(a.name));
}

// ── One transaction that needs coding ────────────────────────────────────────

export type UncatTxn = {
  qboId: string;
  entity: UncatEntity;
  txnDate: string | null;
  /** The whole transaction. */
  totalAmt: number;
  /** Only the lines still parked in an uncategorised account. */
  uncatAmt: number;
  currency: string | null;
  docNumber: string | null;
  /** Supplier, customer, or whoever the bank feed named. */
  partyName: string | null;
  /** Which parking account it landed in — the firm wants to see the difference
   *  between "no category" and "the client was asked and never answered". */
  accountName: string | null;
  /** The bank descriptor. Very often the ONLY clue anyone has, so it is carried
   *  all the way to the screen rather than summarised away. */
  memo: string | null;
  /** The specific lines to recode. A transaction can be half-coded already, and
   *  touching a line somebody deliberately categorised would be vandalism. */
  lineIds: string[];
};

export type UncatScan = {
  txns: UncatTxn[];
  /** Every posted transaction considered, coded or not — the denominator. */
  considered: number;
  /** The accounts treated as uncategorised, so the firm can check the premise. */
  parkingAccounts: LedgerAccount[];
  truncated: boolean;
};

// Turn one queried row into a to-code transaction, or null when every line on it
// already has a real account.
export function rowToUncatTxn(
  table: UncatTable,
  row: Record<string, unknown>,
  uncatAccountIds: ReadonlySet<string>,
): UncatTxn | null {
  const id = typeof row.Id === "string" ? row.Id : null;
  if (!id) return null;

  const detailKey = LINE_DETAIL_KEY[table];
  const lines = Array.isArray(row.Line) ? row.Line : [];

  const lineIds: string[] = [];
  let uncatAmt = 0;
  let accountName: string | null = null;
  let memo: string | null = null;

  for (const l of lines) {
    const line = l as Record<string, unknown>;
    const detail = line[detailKey] as
      | { AccountRef?: { value?: unknown; name?: unknown } }
      | undefined;
    const acctId = detail?.AccountRef?.value;
    if (typeof acctId !== "string" || !uncatAccountIds.has(acctId)) continue;

    // A line with no id cannot be addressed on the way back — QuickBooks
    // matches lines by id on update, and a nameless line would make the write
    // ambiguous. Skipped rather than guessed at by position.
    const lineId = typeof line.Id === "string" ? line.Id : null;
    if (!lineId) continue;

    lineIds.push(lineId);
    if (typeof line.Amount === "number") uncatAmt += line.Amount;
    if (!accountName && typeof detail?.AccountRef?.name === "string") {
      accountName = detail.AccountRef.name;
    }
    if (!memo && typeof line.Description === "string" && line.Description.trim()) {
      memo = line.Description.trim();
    }
  }

  if (lineIds.length === 0) return null;

  const totalAmt = typeof row.TotalAmt === "number" ? row.TotalAmt : uncatAmt;

  // The other party sits in a different field on each table, and on a Deposit it
  // is per-line rather than on the header — a deposit can bundle several payers,
  // so the header genuinely has nobody to name.
  const partyRef = (
    table === "Bill"
      ? row.VendorRef
      : table === "Purchase"
        ? row.EntityRef
        : undefined
  ) as { name?: unknown } | undefined;
  let partyName = typeof partyRef?.name === "string" ? partyRef.name : null;
  if (!partyName && table === "Deposit") partyName = firstDepositPayer(lines);

  const currencyRaw = (row.CurrencyRef as { value?: unknown } | undefined)?.value;
  const privateNote =
    typeof row.PrivateNote === "string" && row.PrivateNote.trim()
      ? row.PrivateNote.trim()
      : null;

  return {
    qboId: id,
    entity: ENTITY_OF[table],
    txnDate: typeof row.TxnDate === "string" ? row.TxnDate : null,
    totalAmt,
    uncatAmt,
    currency: typeof currencyRaw === "string" ? currencyRaw : null,
    docNumber: typeof row.DocNumber === "string" ? row.DocNumber : null,
    partyName,
    accountName,
    memo: memo ?? privateNote,
    lineIds,
  };
}

function firstDepositPayer(lines: ReadonlyArray<unknown>): string | null {
  for (const l of lines) {
    const detail = (l as Record<string, unknown>).DepositLineDetail as
      | { Entity?: { name?: unknown } }
      | undefined;
    const name = detail?.Entity?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

export function uncatKey(entity: string, qboId: string): string {
  return `${entity.toLowerCase()}:${qboId}`;
}

// Biggest uncoded amount first. A firm clearing a month works down from the
// entries that move the numbers, not up from the oldest — and the long tail of
// $4 charges is exactly what a client should be asked about in bulk rather than
// what an accountant should read one at a time.
export function sortUncat(txns: UncatTxn[]): UncatTxn[] {
  return [...txns].sort((a, b) => Math.abs(b.uncatAmt) - Math.abs(a.uncatAmt));
}

// ── The I/O half ─────────────────────────────────────────────────────────────

// The client's whole chart of accounts, live.
//
// Read live rather than from the cache (quickbooks-cache.ts) on purpose: the
// firm is about to WRITE to this ledger, and a picker offering an account that
// was deleted last week produces a failed write and a confused accountant. The
// cache is for pickers that only have to be roughly right.
export async function readAccounts(ctx: {
  accessToken: string;
  realmId: string;
  environment?: QuickbooksEnvironment;
}): Promise<LedgerAccount[]> {
  const resp = await quickbooksQuery(
    ctx.accessToken,
    ctx.realmId,
    `SELECT * FROM Account MAXRESULTS ${MAX_ROWS}`,
    ctx.environment,
  );
  const rows = Array.isArray(resp.Account)
    ? (resp.Account as Array<Record<string, unknown>>)
    : [];
  return rowsToAccounts(rows);
}

// Scan one client's books for transactions still parked in an uncategorised
// account.
//
// THROWS on a query failure. A caller must never turn a failed read into an
// empty list: "we could not look" and "there is nothing to code" are opposite
// answers, and a close board that confuses them tells a firm a month is clean
// when nobody has checked.
export async function scanUncategorized(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  opts: { from: string; to: string; accounts?: readonly LedgerAccount[] },
): Promise<UncatScan> {
  const accounts = opts.accounts ?? (await readAccounts(ctx));
  const parkingAccounts = uncategorizedAmong(accounts);
  if (parkingAccounts.length === 0) {
    return { txns: [], considered: 0, parkingAccounts, truncated: false };
  }
  const ids = new Set(parkingAccounts.map((a) => a.id));

  let truncated = false;
  const txns: UncatTxn[] = [];
  let considered = 0;

  for (const table of UNCAT_TABLES) {
    const sql =
      `SELECT * FROM ${table} WHERE TxnDate >= '${opts.from}' ` +
      `AND TxnDate <= '${opts.to}' ORDERBY TxnDate MAXRESULTS ${MAX_ROWS}`;
    const resp = await quickbooksQuery(
      ctx.accessToken,
      ctx.realmId,
      sql,
      ctx.environment,
    );
    const rows = Array.isArray(resp[table])
      ? (resp[table] as Array<Record<string, unknown>>)
      : [];
    if (rows.length >= MAX_ROWS) truncated = true;
    considered += rows.length;
    for (const row of rows) {
      const txn = rowToUncatTxn(table, row, ids);
      if (txn) txns.push(txn);
    }
  }

  return { txns: sortUncat(txns), considered, parkingAccounts, truncated };
}

// ── Describing one to the person who has to answer for it ────────────────────

// The client reads this, not the accountant. It names what they would recognise
// — who, how much, when — and never an account code or a QuickBooks id. The
// bank descriptor is included when there is one, because "AMZN Mktp CA*R42K9"
// is frequently the only thing that will jog a memory.
export function describeUncatForClient(
  txn: UncatTxn,
  opts: { locale?: "en" | "fr" } = {},
): string {
  const amount = formatAmount(Math.abs(txn.uncatAmt), txn.currency);
  const who = txn.partyName?.trim() || txn.memo?.trim() || null;
  const when = txn.txnDate ? formatDate(txn.txnDate, opts.locale) : null;
  if (opts.locale === "fr") {
    const head = who ? `${amount} — ${who}` : `Montant de ${amount}`;
    return when ? `${head} le ${when}` : head;
  }
  const head = who ? `${amount} — ${who}` : `${amount} payment`;
  return when ? `${head} on ${when}` : head;
}

function formatAmount(n: number, currency: string | null): string {
  const s = n.toFixed(2);
  return currency ? `${s} ${currency}` : `$${s}`;
}

// Deliberately not Intl-with-a-timezone: an ISO date from QuickBooks is a
// calendar date, and running it through a Date would shift it a day for anyone
// west of UTC — turning "3 July" into "2 July" on the client's screen.
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_FR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

function formatDate(iso: string, locale?: "en" | "fr"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = (locale === "fr" ? MONTHS_FR : MONTHS_EN)[Number(mo) - 1];
  if (!month) return iso;
  const day = String(Number(d));
  return locale === "fr" ? `${day} ${month} ${y}` : `${month} ${day}, ${y}`;
}
