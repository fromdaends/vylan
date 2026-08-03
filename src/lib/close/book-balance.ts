// The BOOKS half of a bank reconciliation: what the ledger says each bank and
// credit-card account held at period end.
//
// Both ledgers answer through a REPORT, and for opposite reasons neither
// entity list can be used instead:
//
//   Xero    — the Account object carries no balance field at all (confirmed in
//             their OpenAPI spec). The BankSummary report is the answer, and a
//             good one: it returns Opening/Closing Balance per bank account
//             with the accountID attached, for an explicit date range.
//   QuickBooks — Account.CurrentBalance exists but has NO as-of date. It is a
//             LIVE balance, so using it to reconcile July would silently
//             compare today's books against July's statement. Period-end has
//             to come from a report with an end date.
//
// Everything here is a PURE parser over the JSON those reports return, so the
// shapes are testable without a live connection — which matters, because this
// machine has no QuickBooks credentials and an unverified parser that invents
// a number is far worse than one that admits it cannot read.
//
// FAIL TO NULL, NEVER TO ZERO. Every function returns null for an account it
// could not read. reconcileAccount() then reports "unknown", and the board
// says so. A parser that returned 0 on a shape it did not recognise would
// produce a confident "off by $4,182.00" — or worse, a green tick against an
// account whose real balance it never saw.

export type BookBalance = {
  accountId: string;
  name: string;
  kind: "bank" | "credit_card";
  // Period-end balance in integer cents, or null when unreadable.
  balanceCents: number | null;
};

// Money arrives as a decimal string ("1234.56", "-89", "1,234.56"). Convert to
// integer cents without ever touching a float beyond the parse, and reject
// anything that is not a number rather than coercing it to 0.
export function toCents(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  }
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\s,]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

// ---------------------------------------------------------------------------
// Xero — BankSummary report
// ---------------------------------------------------------------------------

// The report comes back as Rows → (Section) → Rows → Row, each Row a list of
// Cells. The first cell is the account name and carries an Attributes entry
// whose Value is the accountID; the LAST cell is the closing balance.
// Columns are: Bank Accounts | Opening Balance | Cash Received | Cash Spent |
// Closing Balance.
type XeroCell = {
  Value?: unknown;
  Attributes?: { Id?: string; Value?: string }[];
};
type XeroRow = { RowType?: string; Cells?: XeroCell[]; Rows?: XeroRow[] };

export function parseXeroBankSummary(
  report: { Rows?: XeroRow[] } | null | undefined,
  // Account kind by id, from the connection's cached chart of accounts —
  // BankSummary itself does not say which are credit cards.
  kindById: Map<string, "bank" | "credit_card"> = new Map(),
): BookBalance[] {
  const out: BookBalance[] = [];
  const walk = (rows: XeroRow[] | undefined) => {
    for (const row of rows ?? []) {
      if (row.Rows?.length) walk(row.Rows);
      const cells = row.Cells;
      // A data row needs at least a name and a closing balance; header rows
      // carry no Attributes and are skipped by the id lookup below.
      if (row.RowType !== "Row" || !cells || cells.length < 2) continue;
      const first = cells[0];
      const accountId = first?.Attributes?.find(
        (a) => a.Id === "accountID",
      )?.Value;
      if (!accountId) continue;
      const closing = cells[cells.length - 1];
      out.push({
        accountId,
        name: typeof first?.Value === "string" ? first.Value : accountId,
        kind: kindById.get(accountId) ?? "bank",
        balanceCents: toCents(closing?.Value),
      });
    }
  };
  walk(report?.Rows);
  return out;
}

// ---------------------------------------------------------------------------
// QuickBooks — TrialBalance / BalanceSheet report
// ---------------------------------------------------------------------------

// QuickBooks reports nest as Rows.Row[], each either a Section (with its own
// Rows) or a data Row with ColData[]. The first ColData carries the account
// name and its `id`; the numeric columns follow.
//
// ⚠️ UNVERIFIED AGAINST A LIVE COMPANY. This machine has no QuickBooks
// credentials, so this parser is written from the documented report shape and
// tested against fixtures only. It is deliberately strict: an unrecognised
// shape yields null (→ "unknown"), never a number.
type QboColData = { value?: unknown; id?: string };
type QboRow = {
  type?: string;
  ColData?: QboColData[];
  Rows?: { Row?: QboRow[] };
  group?: string;
};

export function parseQuickbooksBalances(
  report: { Rows?: { Row?: QboRow[] } } | null | undefined,
  // Which account ids are bank / credit card, and what to call them. Anything
  // not in here is ignored: a trial balance lists EVERY account, and summing
  // revenue accounts into a bank reconciliation would be nonsense.
  accounts: Map<string, { name: string; kind: "bank" | "credit_card" }>,
): BookBalance[] {
  const found = new Map<string, BookBalance>();
  const walk = (rows: QboRow[] | undefined) => {
    for (const row of rows ?? []) {
      if (row.Rows?.Row?.length) walk(row.Rows.Row);
      const cols = row.ColData;
      if (!cols?.length) continue;
      const id = cols[0]?.id;
      if (!id) continue;
      const account = accounts.get(id);
      if (!account) continue;
      // The balance is the last column carrying a parseable number — a trial
      // balance splits debit/credit across two columns and only one is filled.
      let balance: number | null = null;
      for (let i = cols.length - 1; i >= 1; i--) {
        const cents = toCents(cols[i]?.value);
        if (cents != null && cents !== 0) {
          balance = cents;
          break;
        }
        // Remember an explicit zero, but keep looking for a non-zero column.
        if (cents === 0 && balance == null) balance = 0;
      }
      found.set(id, {
        accountId: id,
        name: account.name,
        kind: account.kind,
        balanceCents: balance,
      });
    }
  };
  walk(report?.Rows?.Row);

  // Every known bank account gets a row, even one the report never mentioned —
  // as null, so it reads "could not read" rather than vanishing. An account
  // silently missing from a reconciliation screen is the bug that lets a month
  // be closed on incomplete books.
  const out: BookBalance[] = [];
  for (const [id, account] of accounts) {
    out.push(
      found.get(id) ?? {
        accountId: id,
        name: account.name,
        kind: account.kind,
        balanceCents: null,
      },
    );
  }
  return out;
}
