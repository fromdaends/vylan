// Turning "this expense has no receipt" into a question the client can answer.
//
// A chase item is an ordinary request_items row — same checklist, same portal,
// same upload — carrying one extra thing: which transaction in the client's
// books it is about (`ledger_txn`, migration 1120). That reference is the whole
// point. Without it the receipt that comes back looks like any other document
// and would be posted as a NEW transaction, double-counting an expense already
// in the ledger.
//
// WHY THIS FAILS CLOSED. Every other pre-migration path in this repo degrades
// gracefully: the column is missing, the feature quietly does less, nothing
// breaks. That would be actively harmful here. A chase item created without its
// reference still shows up in the client's portal, the client still uploads a
// receipt, and the receipt still gets posted — as a duplicate. Silently doing
// less would mean silently corrupting the client's books. So if the column is
// not there, we refuse to create anything and say why.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
import {
  describeGapForClient,
  type ReceiptGap,
} from "@/lib/quickbooks/receipt-gap";

// The stored reference. Deliberately carries display context (amount, date,
// supplier) alongside the ids: the portal shows a client what is being asked
// about, and re-reading the ledger to render a checklist row would be absurd.
export type LedgerTxnRef = {
  provider: "quickbooks" | "xero";
  entity: "bill" | "purchase";
  txnId: string;
  amount: number;
  currency: string | null;
  txnDate: string | null;
  vendorName: string | null;
};

export function ledgerRefOfGap(
  gap: ReceiptGap,
  provider: "quickbooks" | "xero" = "quickbooks",
): LedgerTxnRef {
  return {
    provider,
    entity: gap.entity,
    txnId: gap.qboId,
    amount: gap.totalAmt,
    currency: gap.currency,
    txnDate: gap.txnDate,
    vendorName: gap.vendorName,
  };
}

// Narrow an unknown jsonb value back to a reference. Anything malformed reads as
// "not chasing a transaction" — which routes the document down the ordinary
// create path. Safe by construction: an ordinary upload never double-counts.
export function parseLedgerRef(v: unknown): LedgerTxnRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const provider = o.provider === "xero" ? "xero" : o.provider === "quickbooks" ? "quickbooks" : null;
  const entity = o.entity === "purchase" ? "purchase" : o.entity === "bill" ? "bill" : null;
  const txnId = typeof o.txnId === "string" && o.txnId ? o.txnId : null;
  if (!provider || !entity || !txnId) return null;
  return {
    provider,
    entity,
    txnId,
    amount: typeof o.amount === "number" ? o.amount : 0,
    currency: typeof o.currency === "string" ? o.currency : null,
    txnDate: typeof o.txnDate === "string" ? o.txnDate : null,
    vendorName: typeof o.vendorName === "string" ? o.vendorName : null,
  };
}

export class LedgerRefUnsupportedError extends Error {
  constructor() {
    super(
      "Receipt chasing needs database update 1120. Run supabase/migrations/1120_request_item_ledger_txn.sql, then try again.",
    );
    this.name = "LedgerRefUnsupportedError";
  }
}

// Which transactions on this engagement are ALREADY being chased.
//
// Asking twice for the same receipt is the fastest way to make a client stop
// reading their portal, so every send is filtered through this. Returns keys of
// the form "entity:txnId" (see receipt-gap.gapKey — ids are unique per type,
// not globally).
export async function alreadyChasedKeys(
  engagementId: string,
): Promise<Set<string>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("request_items")
    .select("ledger_txn")
    .eq("engagement_id", engagementId)
    .not("ledger_txn", "is", null);
  if (error) {
    // Pre-migration there is nothing to collide with, so an empty set is the
    // truthful answer here — unlike the create path, which must refuse.
    if (isMissingSchema(error)) return new Set();
    throw error;
  }
  const keys = new Set<string>();
  for (const row of data ?? []) {
    const ref = parseLedgerRef((row as { ledger_txn: unknown }).ledger_txn);
    if (ref) keys.add(`${ref.entity}:${ref.txnId}`);
  }
  return keys;
}

export type ChaseResult = {
  created: number;
  // Gaps skipped because this engagement already asks about them.
  skippedDuplicate: number;
};

// Create one checklist item per gap, on an engagement the client can see.
export async function createReceiptChaseItems(input: {
  engagementId: string;
  gaps: ReceiptGap[];
  provider?: "quickbooks" | "xero";
}): Promise<ChaseResult> {
  if (input.gaps.length === 0) return { created: 0, skippedDuplicate: 0 };
  const supabase = await getServerSupabase();
  const existing = await alreadyChasedKeys(input.engagementId);

  const fresh = input.gaps.filter(
    (g) => !existing.has(`${g.entity}:${g.qboId}`),
  );
  const skippedDuplicate = input.gaps.length - fresh.length;
  if (fresh.length === 0) return { created: 0, skippedDuplicate };

  const { data: last } = await supabase
    .from("request_items")
    .select("order_index")
    .eq("engagement_id", input.engagementId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  let idx = (last?.order_index ?? -1) + 1;

  const rows = fresh.map((gap) => ({
    engagement_id: input.engagementId,
    // The label IS the question. A client scanning a checklist should know
    // which purchase this is without opening anything.
    label: `Receipt — ${describeGapForClient(gap)}`,
    label_fr: `Reçu — ${describeGapForClient(gap, { locale: "fr" })}`,
    description:
      "This payment is in your books but we don't have the receipt for it. Upload the receipt or supplier invoice.",
    description_fr:
      "Ce paiement figure dans vos livres mais nous n'avons pas le reçu correspondant. Téléversez le reçu ou la facture du fournisseur.",
    doc_type: "receipt",
    // Never `required`: a missing receipt is often a genuinely lost one, and a
    // required item the client cannot satisfy blocks the whole engagement from
    // ever reaching complete.
    required: false,
    order_index: idx++,
    status: "pending" as const,
    ledger_txn: ledgerRefOfGap(gap, input.provider ?? "quickbooks"),
  }));

  const { error } = await supabase.from("request_items").insert(rows);
  if (error) {
    // The one place refusing is safer than degrading — see the header.
    if (isMissingSchema(error)) throw new LedgerRefUnsupportedError();
    throw error;
  }

  // New checklist lines change the denominator the engagement stage reads: the
  // client owes something again, so an engagement sitting in review comes back
  // to collecting. Same hook addItemToEngagement uses.
  await syncEngagementStage(supabase, input.engagementId);
  return { created: rows.length, skippedDuplicate };
}

// The transaction a given request item is chasing, or null for an ordinary one.
export async function ledgerRefForItem(
  itemId: string,
): Promise<LedgerTxnRef | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("request_items")
    .select("ledger_txn")
    .eq("id", itemId)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
  return parseLedgerRef((data as { ledger_txn?: unknown } | null)?.ledger_txn);
}
