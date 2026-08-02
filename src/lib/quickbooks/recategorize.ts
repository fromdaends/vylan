// Writing the answer back: move a parked line onto the account it belongs on.
//
// This is the return leg of the uncategorised loop. The scan (uncategorized.ts)
// finds what has no category; this puts one there, in the client's actual books,
// so the firm never opens QuickBooks to finish the job.
//
// THREE RULES, EACH LEARNED FROM A WAY THIS GOES WRONG.
//
//   1. READ, THEN WRITE THE WHOLE THING. Intuit's "sparse" update replaces the
//      entire Line array with whatever you send — so a sparse update naming one
//      line silently DELETES every other line on the transaction. A three-line
//      expense would come back as a one-line expense and the books would be
//      wrong by the difference. The only safe shape is a full update built from
//      a fresh read.
//
//   2. TOUCH ONLY THE NAMED LINES. A transaction is often half-coded already:
//      someone categorised the parking fee and left the rest. Re-pointing a line
//      a human deliberately set is vandalism, and it is invisible vandalism —
//      nothing in QuickBooks says who changed it or why.
//
//   3. LET THE SYNCTOKEN REFUSE. It is QuickBooks' optimistic lock. If anyone
//      edited the transaction between our read and our write, the write fails.
//      That failure is correct and is surfaced as an error, never retried with a
//      refreshed token — a retry loop here would let Vylan quietly overwrite the
//      client's own bookkeeper.
//
// Amounts, dates, suppliers, tax and everything else are carried through
// untouched. This changes exactly one thing: which account a line points at.

import {
  quickbooksQuery,
  quickbooksUpdateEntity,
  type QuickbooksEnvironment,
} from "@/lib/quickbooks/client";
import {
  lineDetailKeyOf,
  rowToUncatTxn,
  tableOf,
  type UncatEntity,
} from "@/lib/quickbooks/uncategorized";

/** The account a line is being moved onto. */
export type RecodeAccount = { id: string; name: string | null };

// ── The pure half ────────────────────────────────────────────────────────────

// Build the object to send back, with only the named lines re-pointed.
//
// Returns which line ids were actually changed. A line that has already been
// categorised by someone else no longer carries the detail block we are looking
// for at the account we expected, so it simply does not appear in `changed` —
// and a call where nothing changed is a stale call, not a failed one.
export function retargetLines(
  txn: Record<string, unknown>,
  entity: UncatEntity,
  lineIds: readonly string[],
  account: RecodeAccount,
): { body: Record<string, unknown>; changed: string[] } {
  const detailKey = lineDetailKeyOf(entity);
  const wanted = new Set(lineIds);
  const changed: string[] = [];

  const lines = Array.isArray(txn.Line) ? txn.Line : [];
  const nextLines = lines.map((l) => {
    const line = l as Record<string, unknown>;
    const id = typeof line.Id === "string" ? line.Id : null;
    if (!id || !wanted.has(id)) return line;

    const detail = line[detailKey] as Record<string, unknown> | undefined;
    // No account-shaped detail block means this is an item-based line pointing
    // at a product, not an account. There is nothing here to recode.
    if (!detail || typeof detail !== "object") return line;

    changed.push(id);
    return {
      ...line,
      [detailKey]: {
        ...detail,
        // `name` is advisory — QuickBooks resolves by value — but sending it
        // keeps the payload readable in a log when a write is being diagnosed.
        AccountRef: account.name
          ? { value: account.id, name: account.name }
          : { value: account.id },
      },
    };
  });

  return { body: { ...txn, Line: nextLines }, changed };
}

// QuickBooks ids are numeric strings. Anything else never reaches a query — the
// id is interpolated into QBO's SQL-like query language, and a value that is not
// a plain number has no business being there.
export function isQboId(v: string): boolean {
  return /^\d+$/.test(v);
}

// ── The I/O half ─────────────────────────────────────────────────────────────

export async function readTransaction(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  entity: UncatEntity,
  txnId: string,
): Promise<Record<string, unknown> | null> {
  if (!isQboId(txnId)) return null;
  const table = tableOf(entity);
  const resp = await quickbooksQuery(
    ctx.accessToken,
    ctx.realmId,
    `SELECT * FROM ${table} WHERE Id = '${txnId}'`,
    ctx.environment,
  );
  const rows = Array.isArray(resp[table])
    ? (resp[table] as Array<Record<string, unknown>>)
    : [];
  return rows[0] ?? null;
}

export type RecodeResult =
  | { ok: true; changed: number; amount: number; syncToken: string }
  | { ok: false; reason: "not_found" | "stale" };

// Move whatever is still parked on one transaction onto `account`.
//
// The caller names the transaction and the destination. It does NOT name the
// lines — this reads the transaction and works out for itself which lines are
// still sitting in a parking account. That is deliberate: the request comes from
// a browser, and a caller that could name lines could re-point any line of any
// transaction in the client's books, including ones a human deliberately coded.
//
// Throws a QuickbooksError when the ledger refuses the write (including the
// stale-SyncToken case). Returns `{ ok: false }` for the two outcomes that are
// not failures: the transaction is gone, or somebody already coded it.
export async function recategorizeTransaction(
  ctx: {
    accessToken: string;
    realmId: string;
    environment?: QuickbooksEnvironment;
  },
  input: {
    entity: UncatEntity;
    txnId: string;
    /** Ids of the accounts that count as "not coded yet" for this company. */
    parkingAccountIds: ReadonlySet<string>;
    account: RecodeAccount;
  },
): Promise<RecodeResult> {
  const row = await readTransaction(ctx, input.entity, input.txnId);
  if (!row) return { ok: false, reason: "not_found" };

  // Recomputed from the transaction as it stands RIGHT NOW, not from what the
  // screen was showing when the firm pressed the button.
  const parked = rowToUncatTxn(
    tableOf(input.entity),
    row,
    input.parkingAccountIds,
  );
  if (!parked) return { ok: false, reason: "stale" };

  const { body, changed } = retargetLines(
    row,
    input.entity,
    parked.lineIds,
    input.account,
  );
  // Nothing left to move — somebody categorised it between the firm loading the
  // list and pressing the button. Reported as stale so the screen can say so,
  // rather than sending a write that would be a no-op at best.
  if (changed.length === 0) return { ok: false, reason: "stale" };

  const table = tableOf(input.entity);
  const result = await quickbooksUpdateEntity(
    ctx,
    { path: table.toLowerCase(), responseKey: table },
    body,
  );
  return {
    ok: true,
    changed: changed.length,
    amount: parked.uncatAmt,
    syncToken: result.syncToken,
  };
}
