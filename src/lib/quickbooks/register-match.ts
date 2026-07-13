// QuickBooks smart match-or-create (Stage 5, smart posting part 3).
//
// Before creating a transaction for an approved draft, search the POSTED
// register for the same transaction: the client's bank feed (or their
// bookkeeper) may have recorded it before the receipt reached Vylan. Matching
// is on AMOUNT (exact, to the penny) + DATE (a ±window around the receipt
// date) — deliberately NOT on vendor name, because the name printed on a
// receipt rarely matches the bank descriptor QuickBooks recorded. The vendor is
// only used NEGATIVELY: a candidate whose vendor clearly contradicts the
// receipt's vendor is never auto-attached (the accountant confirms instead).
//
// The "For Review" bank-feed queue is walled off from the API (for every app —
// Dext/Hubdoc included), so this reads only already-POSTED transactions via the
// /query endpoint. TotalAmt decimals are finicky in QBO's SQL dialect, so the
// query filters by date window only and the amount is compared here in JS.

import {
  quickbooksQuery,
  type QboTxnEntity,
  type QuickbooksEnvironment,
} from "@/lib/quickbooks/client";
import { nameScore, MATCH_THRESHOLD } from "@/lib/quickbooks/suggest";

// How far the posted transaction's date may sit from the receipt date and still
// count as "the same transaction". Bank charges usually settle 1–3 business
// days after the receipt; ±5 calendar days absorbs weekends/holidays without
// pulling in much noise (founder-confirmed default).
export const REGISTER_MATCH_WINDOW_DAYS = 5;

// QBO's /query page cap. If a window returns this many rows the read was likely
// TRUNCATED — we may have missed candidates, so a "clear" verdict can't be
// trusted (see classifyRegisterMatch).
const MAX_REGISTER_ROWS = 1000;

// One already-posted QuickBooks transaction that matches the draft's amount +
// date window. `vendor*` is the other party (VendorRef / EntityRef /
// CustomerRef by entity). syncToken is carried so a match can be recorded with
// the same fields as a created transaction.
export type RegisterCandidate = {
  qboId: string;
  entity: QboTxnEntity;
  txnDate: string | null;
  totalAmt: number;
  docNumber: string | null;
  vendorId: string | null;
  vendorName: string | null;
  syncToken: string | null;
  // The transaction's currency (CurrencyRef.value, e.g. "CAD"/"USD"), or null in
  // a single-currency company where QuickBooks omits CurrencyRef. A non-null
  // value means the company has MULTICURRENCY on, so TotalAmt is stated in THIS
  // currency — which need not be the home currency the draft posts in. Such a
  // candidate is never auto-attached (classifyRegisterMatch downgrades it to a
  // confirm) so a USD 100.00 can't silently attach to a CAD $100.00 draft.
  currency: string | null;
};

export type RegisterSearch = {
  candidates: RegisterCandidate[];
  // True when any entity's query hit the page cap: the candidate list may be
  // incomplete, so auto-attach is off the table (confirm instead).
  truncated: boolean;
};

const ENTITY_TABLE: Record<QboTxnEntity, string> = {
  bill: "Bill",
  purchase: "Purchase",
  invoice: "Invoice",
  salesreceipt: "SalesReceipt",
};

// Shift an ISO YYYY-MM-DD date by whole days (UTC arithmetic — no DST edges).
export function shiftIsoDate(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Amounts match when equal to the penny (float-safe half-cent tolerance).
function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

// The other-party reference field differs by entity: Bill -> VendorRef,
// Purchase -> EntityRef (vendor/customer/employee), Invoice + SalesReceipt ->
// CustomerRef.
function partyRefOf(
  entity: QboTxnEntity,
  row: Record<string, unknown>,
): { value?: unknown; name?: unknown } | null {
  const raw =
    entity === "invoice" || entity === "salesreceipt"
      ? row.CustomerRef
      : entity === "bill"
        ? row.VendorRef
        : row.EntityRef;
  return raw && typeof raw === "object"
    ? (raw as { value?: unknown; name?: unknown })
    : null;
}

// Query the posted register for candidates: every transaction of the given
// entity types whose TxnDate falls in date ± windowDays AND whose TotalAmt
// equals `amount` to the penny, excluding ids in `excludeQboIds` (transactions
// Vylan itself posted — they must never read as "already in QuickBooks", or
// two same-priced receipts would flag each other). THROWS on a query failure;
// the caller treats any throw as "can't check" and fails open to a create.
export async function findRegisterCandidates(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  opts: {
    entities: QboTxnEntity[];
    date: string; // ISO YYYY-MM-DD (the draft's effective date)
    windowDays: number;
    amount: number; // gross total — compared against TotalAmt
    excludeQboIds: ReadonlySet<string>;
  },
): Promise<RegisterSearch> {
  const from = shiftIsoDate(opts.date, -opts.windowDays);
  const to = shiftIsoDate(opts.date, opts.windowDays);
  const candidates: RegisterCandidate[] = [];
  let truncated = false;

  for (const entity of opts.entities) {
    const table = ENTITY_TABLE[entity];
    const sql =
      `SELECT * FROM ${table} WHERE TxnDate >= '${from}' AND TxnDate <= '${to}' ` +
      `ORDERBY TxnDate MAXRESULTS ${MAX_REGISTER_ROWS}`;
    const resp = await quickbooksQuery(
      ctx.accessToken,
      ctx.realmId,
      sql,
      ctx.environment,
    );
    const rows = Array.isArray(resp[table])
      ? (resp[table] as Array<Record<string, unknown>>)
      : [];
    if (rows.length >= MAX_REGISTER_ROWS) truncated = true;

    for (const row of rows) {
      // A Purchase with Credit=true is a vendor / credit-card REFUND (money back
      // TO the client), not an expense. QuickBooks stores it in the SAME table
      // with a POSITIVE TotalAmt, so a $200 refund is otherwise indistinguishable
      // from a $200 expense in every field we read. It can never be "the same
      // transaction" as an expense receipt — drop it so it neither auto-attaches
      // nor pads the confirm list. (Bill/Invoice have no Credit flag, so this is
      // a no-op for them.)
      if (row.Credit === true) continue;
      const totalAmt = typeof row.TotalAmt === "number" ? row.TotalAmt : null;
      if (totalAmt == null || !amountsEqual(totalAmt, opts.amount)) continue;
      const id = typeof row.Id === "string" ? row.Id : null;
      if (!id || opts.excludeQboIds.has(id)) continue;
      const ref = partyRefOf(entity, row);
      const currencyRaw =
        row.CurrencyRef && typeof row.CurrencyRef === "object"
          ? (row.CurrencyRef as { value?: unknown }).value
          : null;
      candidates.push({
        qboId: id,
        entity,
        txnDate: typeof row.TxnDate === "string" ? row.TxnDate : null,
        totalAmt,
        docNumber: typeof row.DocNumber === "string" ? row.DocNumber : null,
        vendorId: typeof ref?.value === "string" ? ref.value : null,
        vendorName: typeof ref?.name === "string" ? ref.name : null,
        syncToken: typeof row.SyncToken === "string" ? row.SyncToken : null,
        currency: typeof currencyRaw === "string" ? currencyRaw : null,
      });
    }
  }

  return { candidates, truncated };
}

export type RegisterMatchVerdict =
  | { kind: "none" }
  | { kind: "clear"; candidate: RegisterCandidate }
  | { kind: "confirm" };

// Does the candidate's recorded vendor CONTRADICT the draft's? Only a positive
// contradiction blocks auto-attach: the candidate names a DIFFERENT vendor (by
// id) whose name looks nothing like either the accountant's pick or the name
// printed on the receipt. An empty candidate vendor (typical of a raw bank-feed
// accept) or a same/similar one is fine — bank descriptors rarely match receipt
// names, which is exactly why matching doesn't REQUIRE the vendor to agree.
function vendorContradicts(
  candidate: RegisterCandidate,
  draftVendorId: string | null,
  draftNames: Array<string | null>,
): boolean {
  if (candidate.vendorId == null && candidate.vendorName == null) return false;
  if (draftVendorId != null && candidate.vendorId === draftVendorId)
    return false;
  if (candidate.vendorName == null) {
    // A different vendor id with no name to compare — can't rule it in, so
    // treat as contradicting (the accountant confirms).
    return draftVendorId != null && candidate.vendorId !== draftVendorId;
  }
  const similar = draftNames.some(
    (n) => n != null && nameScore(n, candidate.vendorName!) >= MATCH_THRESHOLD,
  );
  return !similar;
}

// The founder-decided bar for attaching WITHOUT asking: exactly one candidate,
// same entity type the draft would post, stated in the home currency (no
// CurrencyRef), vendor not contradicting, and the search wasn't truncated.
// ANYTHING else with a candidate in play → the accountant confirms. (Amount +
// date window are already guaranteed by findRegisterCandidates.)
export function classifyRegisterMatch(input: {
  search: RegisterSearch;
  draftEntity: QboTxnEntity;
  draftVendorId: string | null;
  // Names the vendor is known by on our side: the effective party pick and the
  // raw name printed on the receipt (partySource). Either matching clears the
  // contradiction check.
  draftVendorNames: Array<string | null>;
}): RegisterMatchVerdict {
  const { candidates, truncated } = input.search;
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length > 1 || truncated) return { kind: "confirm" };
  const c = candidates[0]!;
  if (c.entity !== input.draftEntity) return { kind: "confirm" };
  // Multicurrency guard: a candidate carrying a currency (the company has
  // multicurrency on) has a TotalAmt stated in THAT currency, which may not be
  // the home currency the draft posts in — a USD 100.00 must never silently
  // attach to a CAD $100.00 draft. We can't reliably know the home currency
  // here, so never auto-clear a currency-tagged candidate; let the accountant
  // confirm (the dialog shows the currency code).
  if (c.currency != null) return { kind: "confirm" };
  if (vendorContradicts(c, input.draftVendorId, input.draftVendorNames)) {
    return { kind: "confirm" };
  }
  return { kind: "clear", candidate: c };
}
