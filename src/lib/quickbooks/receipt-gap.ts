// "Which expenses in this client's books have no receipt behind them?"
//
// Vylan's whole bookkeeping path runs one way: a document arrives, it becomes a
// transaction. This runs the OTHER way — start from what is already recorded in
// the client's books, and find the entries with nothing supporting them. Those
// are the ones an accountant has to chase, and chasing them is most of what a
// month-end close actually is.
//
// WHAT IT CAN AND CANNOT SEE. Only transactions already POSTED to the ledger.
// The bank feed's "For Review" queue is walled off from the API for every app,
// Dext and Hubdoc included (see register-match.ts) — so a charge the client has
// not yet accepted into their books is invisible here, to everyone. That is the
// right scope anyway: an expense nobody has recorded yet isn't missing a
// receipt, it's missing a decision.
//
// TWO QUICKBOOKS FACTS THIS IS BUILT AROUND, both learned by getting them wrong
// against a live company:
//
//   1. A transaction does NOT echo its attachments. `GET /bill/{id}` returns no
//      AttachableRef however many documents are on it. Asking the transaction is
//      a check that reports "no receipt" for every transaction ever — wrong in
//      the direction that generates work for the firm. Attachments must be read
//      from the Attachable table and joined back by id.
//   2. Attachable rows are NOT scoped to a date range. There is no TxnDate on
//      them, so the join has to pull the company's attachments and match on the
//      transaction ids we care about, rather than filtering server-side.
//
// EXPENSES ONLY. Bill (unpaid) and Purchase (paid). An Invoice is something the
// CLIENT issued — there is no supplier receipt to chase for it, and listing them
// would bury the real gaps.

import {
  quickbooksQuery,
  type QuickbooksEnvironment,
} from "@/lib/quickbooks/client";
import { formatLedgerAmount } from "./amount-label";

// QuickBooks' /query page cap. Hitting it means the read was TRUNCATED and the
// answer is incomplete — reported rather than silently presented as "all of
// them", because "no gaps found" and "we stopped looking" must never look alike.
const MAX_ROWS = 1000;

// The expense entities a supplier receipt can belong to.
const EXPENSE_TABLES = ["Bill", "Purchase"] as const;
type ExpenseTable = (typeof EXPENSE_TABLES)[number];

const ENTITY_OF: Record<ExpenseTable, "bill" | "purchase"> = {
  Bill: "bill",
  Purchase: "purchase",
};

// One posted expense with no document behind it.
export type ReceiptGap = {
  qboId: string;
  entity: "bill" | "purchase";
  txnDate: string | null;
  totalAmt: number;
  currency: string | null;
  docNumber: string | null;
  vendorId: string | null;
  // What the books call the other party. Often a bank descriptor rather than a
  // trading name — which is exactly why the client is the one who can answer.
  vendorName: string | null;
  // The account the expense was coded to, so the firm can see at a glance
  // whether the gap is a $9 subscription or a $4,000 unexplained purchase.
  accountName: string | null;
};

export type ReceiptGapScan = {
  gaps: ReceiptGap[];
  // Every posted expense considered, gap or not — the denominator. "12 of 340"
  // reads very differently from "12".
  considered: number;
  // True when a query hit the page cap, so `gaps` may be incomplete.
  truncated: boolean;
};

// ── The pure half ────────────────────────────────────────────────────────────

// Transaction ids that have at least one document attached to them.
//
// An Attachable carries AttachableRef[], each with an EntityRef {type, value}.
// A single uploaded file can be linked to several transactions, and a
// transaction can carry several files — so this flattens to a plain id set.
//
// NOTE the id space: QuickBooks ids are unique per ENTITY TYPE, not globally, so
// Bill 42 and Purchase 42 are different transactions. Keys are therefore
// "type:id", lowercased, never the bare id — a bare-id set would silently
// suppress a genuine gap whenever the two tables happened to share a number.
export function attachedTransactionKeys(
  attachables: ReadonlyArray<Record<string, unknown>>,
): Set<string> {
  const keys = new Set<string>();
  for (const a of attachables) {
    const refs = Array.isArray(a.AttachableRef) ? a.AttachableRef : [];
    for (const r of refs) {
      const ref = r as { EntityRef?: { type?: unknown; value?: unknown } };
      const type = ref.EntityRef?.type;
      const value = ref.EntityRef?.value;
      if (typeof type !== "string" || typeof value !== "string") continue;
      keys.add(`${type.toLowerCase()}:${value}`);
    }
  }
  return keys;
}

export function gapKey(entity: string, qboId: string): string {
  return `${entity.toLowerCase()}:${qboId}`;
}

// Turn one queried expense row into a gap, or null when it should not be chased.
export function rowToGap(
  table: ExpenseTable,
  row: Record<string, unknown>,
  attached: ReadonlySet<string>,
): ReceiptGap | null {
  const id = typeof row.Id === "string" ? row.Id : null;
  if (!id) return null;
  const entity = ENTITY_OF[table];
  if (attached.has(gapKey(entity, id))) return null;

  // A Purchase with Credit=true is a REFUND — money coming back to the client.
  // QuickBooks stores it in the same table with a positive TotalAmt, so it is
  // otherwise indistinguishable from an expense. There is no supplier receipt to
  // chase for a refund; asking the client for one is a question with no answer.
  if (row.Credit === true) return null;

  const totalAmt = typeof row.TotalAmt === "number" ? row.TotalAmt : null;
  if (totalAmt == null) return null;
  // A zero-value entry is a placeholder or a fully-credited line, not a purchase
  // anyone kept a receipt for.
  if (Math.abs(totalAmt) < 0.005) return null;

  const ref = (
    table === "Bill" ? row.VendorRef : row.EntityRef
  ) as { value?: unknown; name?: unknown } | undefined;
  const currencyRaw = (row.CurrencyRef as { value?: unknown } | undefined)
    ?.value;

  return {
    qboId: id,
    entity,
    txnDate: typeof row.TxnDate === "string" ? row.TxnDate : null,
    totalAmt,
    currency: typeof currencyRaw === "string" ? currencyRaw : null,
    docNumber: typeof row.DocNumber === "string" ? row.DocNumber : null,
    vendorId: typeof ref?.value === "string" ? ref.value : null,
    vendorName: typeof ref?.name === "string" ? ref.name : null,
    accountName: firstLineAccountName(row),
  };
}

// The account the first expense line was coded to. Purely for the firm's
// scanning — a gap is a gap whether or not this resolves.
function firstLineAccountName(row: Record<string, unknown>): string | null {
  const lines = Array.isArray(row.Line) ? row.Line : [];
  for (const l of lines) {
    const line = l as {
      AccountBasedExpenseLineDetail?: { AccountRef?: { name?: unknown } };
    };
    const name = line.AccountBasedExpenseLineDetail?.AccountRef?.name;
    if (typeof name === "string" && name) return name;
  }
  return null;
}

// Biggest first: an accountant chasing receipts starts with the amounts that
// move the return, not the oldest row. Undated entries sort last rather than
// being dropped — they are still real gaps.
export function sortGaps(gaps: ReceiptGap[]): ReceiptGap[] {
  return [...gaps].sort((a, b) => b.totalAmt - a.totalAmt);
}

// ── The I/O half ─────────────────────────────────────────────────────────────

// Scan one client's books for posted expenses with no document attached.
//
// THROWS on a query failure. A caller must never turn a failed read into an
// empty gap list: "we could not look" and "there is nothing to find" are
// opposite answers, and confusing them is how this class of feature quietly
// tells a firm everything is fine.
export async function scanReceiptGaps(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  opts: { from: string; to: string },
): Promise<ReceiptGapScan> {
  let truncated = false;

  // Attachments first, once for the whole scan. There is no way to ask for only
  // the attachments in a date range (see the header), so this reads the
  // company's Attachable list and joins in memory.
  const attachResp = await quickbooksQuery(
    ctx.accessToken,
    ctx.realmId,
    `SELECT * FROM Attachable MAXRESULTS ${MAX_ROWS}`,
    ctx.environment,
  );
  const attachRows = Array.isArray(attachResp.Attachable)
    ? (attachResp.Attachable as Array<Record<string, unknown>>)
    : [];
  // A truncated ATTACHMENT read is the dangerous direction: attachments we never
  // saw make transactions look unsupported, and the firm chases receipts the
  // client already sent. Surfaced, never swallowed.
  if (attachRows.length >= MAX_ROWS) truncated = true;
  const attached = attachedTransactionKeys(attachRows);

  const gaps: ReceiptGap[] = [];
  let considered = 0;

  for (const table of EXPENSE_TABLES) {
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
      const gap = rowToGap(table, row, attached);
      if (gap) gaps.push(gap);
    }
  }

  return { gaps: sortGaps(gaps), considered, truncated };
}

// ── Describing a gap to the person who has to answer for it ──────────────────

// The client sees this, not the accountant — so it names what they would
// recognise (who, how much, when) and never a QuickBooks id or an account code.
export function describeGapForClient(
  gap: ReceiptGap,
  opts: { locale?: "en" | "fr" } = {},
): string {
  const amount = formatLedgerAmount(gap.totalAmt, gap.currency);
  const who = gap.vendorName?.trim();
  const when = gap.txnDate ? formatDate(gap.txnDate, opts.locale) : null;
  if (opts.locale === "fr") {
    return [
      who ? `${amount} chez ${who}` : `Paiement de ${amount}`,
      when ? ` le ${when}` : "",
    ].join("");
  }
  return [
    who ? `${amount} at ${who}` : `${amount} payment`,
    when ? ` on ${when}` : "",
  ].join("");
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
