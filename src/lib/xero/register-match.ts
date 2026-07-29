// Xero smart match-or-create — don't create a transaction the books already have.
//
// The client's bank feed, or their bookkeeper, may have recorded a purchase
// days before the receipt ever reached Vylan. Creating it again puts the same
// expense in the books twice, which nothing downstream catches: both entries
// look individually correct, and it surfaces at year end as an overstated
// expense and an overstated tax claim.
//
// The QuickBooks path has done this since Stage 5. The Xero path never did,
// which is the entire reason Xero posting is still gated to demo companies.
//
// DELIBERATELY REUSES the QuickBooks classifier rather than forking it. Its
// entity names ("bill", "purchase", "invoice", "salesreceipt") are logical, not
// QuickBooks-specific, and map one-to-one onto Xero's four transaction shapes.
// The verdict rules — never auto-attach when there is more than one candidate,
// when the read was truncated, when the entity differs, when the currency
// differs, or when the other party contradicts — are provider-neutral judgement
// about money, and having two copies of that judgement is how they drift apart.
// Only the SEARCH is Xero's.
//
// Matching is on AMOUNT (exact, to the penny) + DATE (a ±window), NOT on the
// party name: what a receipt prints rarely matches the descriptor a bank feed
// recorded. The party is used only NEGATIVELY, to refuse an auto-attach whose
// contact clearly contradicts the document.

import { xeroGet, XeroError } from "@/lib/xero/client";
import type { XeroReadContext } from "@/lib/xero/connection";
import {
  classifyRegisterMatch,
  REGISTER_MATCH_WINDOW_DAYS,
  type RegisterCandidate,
  type RegisterSearch,
  type RegisterMatchVerdict,
} from "@/lib/quickbooks/register-match";
import type { QboTxnEntity } from "@/lib/quickbooks/client";

// Xero returns at most 100 rows per page. Hitting it means the window may hold
// candidates we never saw, so any verdict that DID find something downgrades to
// a confirm rather than auto-attaching.
const XERO_PAGE_SIZE = 100;

// A Xero register search. Extends the shared shape with readFailed, because
// Xero needs two requests (Invoices + BankTransactions) where QuickBooks needs
// one: a thrown request is the caller's signal there, and here it has to be
// carried back as data.
export type XeroRegisterSearch = RegisterSearch & {
  // At least one of the two register reads did not land. NOT the same as
  // "found nothing" — the caller must decide, and the two callers decide
  // OPPOSITELY: the automatic check fails open (posts anyway, never blocks a
  // legitimate post), the explicit attach fails closed (never creates the very
  // duplicate the accountant said already exists).
  readFailed: boolean;
};

// Xero's four transaction shapes, in the shared logical vocabulary.
function entityForInvoice(type: string | undefined): QboTxnEntity | null {
  if (type === "ACCPAY") return "bill";
  if (type === "ACCREC") return "invoice";
  return null;
}
function entityForBankTransaction(type: string | undefined): QboTxnEntity | null {
  if (type === "SPEND") return "purchase";
  if (type === "RECEIVE") return "salesreceipt";
  return null;
}

// Xero serialises dates as "/Date(1719792000000+0000)/" on some endpoints and
// as plain ISO on others. Returns YYYY-MM-DD, or null when unreadable — an
// unreadable date must not become today's.
export function parseXeroDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const ms = /\/Date\((-?\d+)/.exec(v);
  if (ms) {
    const d = new Date(Number(ms[1]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return iso ? iso[1]! : null;
}

// Money in integer cents so 114.98 never fails to equal 114.98.
function cents(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.round(n * 100)
    : null;
}

// The ±window as the two ISO dates Xero's `where` filter needs.
export function registerWindow(date: string): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const shift = (days: number) =>
    new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return {
    from: shift(-REGISTER_MATCH_WINDOW_DAYS),
    to: shift(REGISTER_MATCH_WINDOW_DAYS),
  };
}

// A Xero `where` clause for a date range. DateTime(y,m,d) is Xero's literal
// syntax; the range is inclusive at both ends.
function whereDateBetween(from: string, to: string): string {
  const lit = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `DateTime(${Number(y)},${Number(m)},${Number(d)})`;
  };
  return `Date >= ${lit(from)} AND Date <= ${lit(to)}`;
}

// A transaction that is VOID or DELETED is not in the books and must never be
// matched against — attaching to one would leave the real expense unrecorded.
function isLiveStatus(status: unknown): boolean {
  const s = typeof status === "string" ? status.toUpperCase() : "";
  return s !== "VOIDED" && s !== "DELETED";
}

// Search the client's Xero books for an already-recorded transaction matching
// this draft's amount and date. Never throws: an unreadable register is
// reported as truncated, which makes the classifier ask rather than assume the
// books are clear.
export async function searchXeroRegister(
  ctx: XeroReadContext,
  input: {
    date: string;
    amountCents: number;
    // Which transaction shapes count. Same-direction only: a $114.98 sale
    // recorded on the same day as a $114.98 expense is a coincidence, not a
    // duplicate, and surfacing it would train accountants to dismiss the
    // confirmation dialog.
    entities: QboTxnEntity[];
    // What this draft would actually be POSTED in: the currency printed on the
    // document, falling back to the organisation's own. A candidate stated in
    // that currency is comparable to the draft; anything else is not. See the
    // normalisation below.
    documentCurrency: string | null;
    orgCurrency: string | null;
  },
): Promise<XeroRegisterSearch> {
  const { from, to } = registerWindow(input.date);
  const where = encodeURIComponent(whereDateBetween(from, to));
  const candidates: RegisterCandidate[] = [];
  const wanted = new Set(input.entities);
  // The DOCUMENT's currency wins over the organisation's. Xero books a
  // transaction in the organisation's currency unless the post says otherwise,
  // so a USD-based organisation holding a CAD document posts CAD -- and a USD
  // 247.83 bill sitting in the window is NOT the same money as a CAD 247.83
  // receipt. Comparing against the organisation alone would have called that a
  // duplicate and attached to it.
  const posting =
    input.documentCurrency?.trim().toUpperCase() ||
    input.orgCurrency?.trim().toUpperCase() ||
    null;
  let truncated = false;
  let readFailed = false;

  async function scan(
    path: "Invoices" | "BankTransactions",
    key: string,
    idField: string,
    toEntity: (t: string | undefined) => QboTxnEntity | null,
  ): Promise<void> {
    try {
      const json = await xeroGet(
        ctx.accessToken,
        ctx.tenantId,
        `${path}?where=${where}&page=1`,
      );
      const rows = (json[key] as Array<Record<string, unknown>> | undefined) ?? [];
      if (rows.length >= XERO_PAGE_SIZE) truncated = true;
      for (const r of rows) {
        if (!isLiveStatus(r.Status)) continue;
        const entity = toEntity(r.Type as string | undefined);
        if (!entity || !wanted.has(entity)) continue;
        const total = cents(r.Total);
        if (total == null || total !== input.amountCents) continue;
        const contact = (r.Contact as Record<string, unknown> | undefined) ?? {};
        candidates.push({
          qboId: String(r[idField] ?? ""),
          entity,
          txnDate: parseXeroDate(r.Date),
          totalAmt: total / 100,
          docNumber:
            (r.InvoiceNumber as string | null) ??
            (r.Reference as string | null) ??
            null,
          vendorId: (contact.ContactID as string | null) ?? null,
          vendorName: (contact.Name as string | null) ?? null,
          // Xero has no SyncToken; undo/attach work from the id alone.
          syncToken: null,
          // The classifier reads a non-null currency as "this total may be
          // stated in something other than what the draft posts in — ask".
          // QuickBooks only sets CurrencyRef when multicurrency is on, but Xero
          // stamps CurrencyCode on EVERY transaction, so passing it through raw
          // would make every single Xero match ask, forever. Normalised here:
          // a candidate in the SAME currency this draft would post in is
          // comparable and reports null; anything else keeps its code and gets
          // confirmed. Both currencies unknown keeps every code, which errs
          // toward asking.
          currency:
            typeof r.CurrencyCode === "string" &&
            posting != null &&
            r.CurrencyCode.toUpperCase() === posting
              ? null
              : ((r.CurrencyCode as string | null) ?? null),
        });
      }
    } catch (e) {
      // A failed read is NOT "the books are clear" — but it is also not a
      // reason to block the post. Reported as BOTH: truncated, so a candidate
      // found by the OTHER register still only gets confirmed, and readFailed,
      // so the caller knows the search was incomplete even when it came back
      // empty.
      console.error(
        `[xero] register search ${path} failed:`,
        e instanceof XeroError ? `${e.code} ${e.message}` : e,
      );
      truncated = true;
      readFailed = true;
    }
  }

  await Promise.all([
    scan("Invoices", "Invoices", "InvoiceID", entityForInvoice),
    scan(
      "BankTransactions",
      "BankTransactions",
      "BankTransactionID",
      entityForBankTransaction,
    ),
  ]);

  return { candidates, truncated, readFailed };
}

// Search + classify in one call, so the posting path reads as one decision.
export async function checkXeroRegister(
  ctx: XeroReadContext,
  input: {
    date: string;
    amountCents: number;
    entities: QboTxnEntity[];
    documentCurrency: string | null;
    orgCurrency: string | null;
    // Xero ids Vylan itself posted for this firm in this organisation. Removed
    // BEFORE classifying, not after: leaving them in would offer to attach a
    // re-posted draft to itself, and would also turn a single real candidate
    // into "more than one" and stop it auto-attaching.
    excludeIds: Set<string>;
    draftEntity: QboTxnEntity;
    draftVendorId: string | null;
    draftVendorNames: Array<string | null>;
  },
): Promise<{
  verdict: RegisterMatchVerdict;
  candidates: RegisterCandidate[];
  readFailed: boolean;
}> {
  const search = await searchXeroRegister(ctx, input);
  const candidates = search.candidates.filter(
    (c) => !input.excludeIds.has(c.qboId),
  );
  return {
    verdict: classifyRegisterMatch({
      search: { candidates, truncated: search.truncated },
      draftEntity: input.draftEntity,
      draftVendorId: input.draftVendorId,
      draftVendorNames: input.draftVendorNames,
    }),
    candidates,
    readFailed: search.readFailed,
  };
}

// The registers worth searching for a draft going out in this direction.
// Both shapes on each side: the same expense can already be in the books as a
// hand-entered bill OR as an accepted bank-feed line, whichever this draft
// would have created.
export function xeroSearchEntities(direction: "income" | "expense"): QboTxnEntity[] {
  return direction === "income"
    ? ["invoice", "salesreceipt"]
    : ["bill", "purchase"];
}
