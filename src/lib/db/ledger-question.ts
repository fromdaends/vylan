// Turning "nobody coded this" into a question the client can answer.
//
// The sibling of receipt-chase.ts, and the other half of the same loop. That one
// asks for the paper behind a transaction; this one asks what the transaction
// WAS. Both hang off the same reference (`ledger_txn`, migration 1120), so the
// answer comes back attached to the entry it explains instead of landing in a
// message thread somebody has to go and find.
//
// WHY THIS FAILS CLOSED. Before migration 1170 the 'question' kind does not
// exist, and an insert naming it is rejected by Postgres. Degrading to a
// document-collection item would be actively harmful: the client would be shown
// an upload box for "what was this $340 for?", a question no file answers, and
// would either ignore it or upload something irrelevant that the AI then tries
// to post to their books. So a create that cannot be a question is refused, and
// says which file to run.
//
// A TRANSACTION CAN CARRY BOTH. A receipt chase and a question about the same
// entry are different asks — "send us the receipt" and "tell us what it was" —
// and a firm may legitimately want both. Deduplication is therefore per KIND,
// not per transaction: asking the same question twice is what annoys a client,
// asking two different things is just the work.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
import {
  describeUncatForClient,
  type UncatEntity,
  type UncatTxn,
} from "@/lib/quickbooks/uncategorized";

export class LedgerQuestionUnsupportedError extends Error {
  constructor() {
    super(
      "Asking a client about a transaction needs database update 1170. Run supabase/migrations/1170_request_item_questions.sql, then try again.",
    );
    this.name = "LedgerQuestionUnsupportedError";
  }
}

// The reference stored on a question item. Same column and the same meaning as
// the receipt chase writes — "this request is about that entry in the books" —
// with one difference that matters.
//
// A QUESTION CAN BE ABOUT A DEPOSIT; a receipt chase never is. So this module
// has its OWN parser rather than reusing receipt-chase's, which narrows `entity`
// to bill | purchase. Widening that one would have been the tempting change and
// the wrong one: its output feeds chase-override, the thing that decides where
// a returned document gets attached, and teaching it to recognise deposits
// would put a new entity type in front of the ledger-write path for no reason.
// A deposit reference stays unparseable over there, which routes any document
// down the ordinary create path — the safe direction.
export type LedgerQuestionRef = {
  provider: "quickbooks" | "xero";
  entity: UncatEntity;
  txnId: string;
  amount: number;
  currency: string | null;
  txnDate: string | null;
  vendorName: string | null;
};

export function ledgerRefOfUncat(
  txn: UncatTxn,
  provider: "quickbooks" | "xero" = "quickbooks",
): LedgerQuestionRef {
  return {
    provider,
    entity: txn.entity,
    txnId: txn.qboId,
    amount: txn.uncatAmt,
    currency: txn.currency,
    txnDate: txn.txnDate,
    vendorName: txn.partyName,
  };
}

// Narrow an unknown jsonb value back to a question's reference. Anything
// malformed reads as "not about a transaction" and is skipped.
export function parseQuestionRef(v: unknown): LedgerQuestionRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const provider =
    o.provider === "xero"
      ? "xero"
      : o.provider === "quickbooks"
        ? "quickbooks"
        : null;
  const entity =
    o.entity === "purchase" || o.entity === "bill" || o.entity === "deposit"
      ? (o.entity as UncatEntity)
      : null;
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

const keyOf = (entity: string, txnId: string) => `${entity}:${txnId}`;

// Which transactions on this engagement have ALREADY been asked about.
//
// Questions only. A transaction whose receipt is being chased has not been
// explained, and vice versa.
export async function alreadyAskedKeys(
  engagementId: string,
): Promise<Set<string>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("request_items")
    .select("ledger_txn")
    .eq("engagement_id", engagementId)
    .eq("kind", "question")
    .not("ledger_txn", "is", null);
  if (error) {
    // Pre-migration there are no question items to collide with, so an empty
    // set is the truthful answer — unlike the create path, which must refuse.
    if (isMissingSchema(error) || isUnknownEnum(error)) return new Set();
    throw error;
  }
  const keys = new Set<string>();
  for (const row of data ?? []) {
    const ref = parseQuestionRef((row as { ledger_txn: unknown }).ledger_txn);
    if (ref) keys.add(keyOf(ref.entity, ref.txnId));
  }
  return keys;
}

// Postgres rejects an unknown enum label with 22P02 (invalid_text_representation)
// rather than the undefined-column code isMissingSchema looks for, so the
// pre-1170 state has its own detector. Matched on the code AND the type name so
// an unrelated bad cast elsewhere can never be read as "migration missing".
function isUnknownEnum(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return (
    (e.code === "22P02" || e.code === "42804") &&
    typeof e.message === "string" &&
    e.message.includes("request_item_kind")
  );
}

export type AskResult = {
  created: number;
  /** Skipped because this engagement already asks about that transaction. */
  skippedDuplicate: number;
};

// Create one question per uncoded transaction, on an engagement the client can
// actually see.
export async function createLedgerQuestions(input: {
  engagementId: string;
  txns: UncatTxn[];
  provider?: "quickbooks" | "xero";
}): Promise<AskResult> {
  if (input.txns.length === 0) return { created: 0, skippedDuplicate: 0 };
  const supabase = await getServerSupabase();
  const existing = await alreadyAskedKeys(input.engagementId);

  const fresh = input.txns.filter(
    (t) => !existing.has(keyOf(t.entity, t.qboId)),
  );
  const skippedDuplicate = input.txns.length - fresh.length;
  if (fresh.length === 0) return { created: 0, skippedDuplicate };

  const { data: last } = await supabase
    .from("request_items")
    .select("order_index")
    .eq("engagement_id", input.engagementId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  let idx = (last?.order_index ?? -1) + 1;

  const rows = fresh.map((txn) => ({
    engagement_id: input.engagementId,
    // The label IS the question. A client scanning their checklist should know
    // which purchase this is about without opening anything.
    label: `What was this for? — ${describeUncatForClient(txn)}`,
    label_fr: `À quoi correspond ce montant ? — ${describeUncatForClient(txn, { locale: "fr" })}`,
    description:
      "This is in your books but we don't know what it was for. A sentence is plenty — what was bought, or who it was for.",
    description_fr:
      "Ceci figure dans vos livres mais nous ne savons pas à quoi cela correspond. Une phrase suffit : ce qui a été acheté, ou pour qui.",
    kind: "question" as const,
    doc_type: "other",
    // Never `required`: a client who genuinely cannot remember a charge from
    // eight months ago must not be able to block the whole engagement from ever
    // reaching complete.
    required: false,
    order_index: idx++,
    status: "pending" as const,
    ledger_txn: ledgerRefOfUncat(txn, input.provider ?? "quickbooks"),
  }));

  const { error } = await supabase.from("request_items").insert(rows);
  if (error) {
    if (isMissingSchema(error) || isUnknownEnum(error)) {
      throw new LedgerQuestionUnsupportedError();
    }
    throw error;
  }

  // New checklist lines change the denominator the engagement stage reads: the
  // client owes something again, so an engagement sitting in review comes back
  // to collecting.
  await syncEngagementStage(supabase, input.engagementId);
  return { created: rows.length, skippedDuplicate };
}

export type LedgerAnswer = {
  itemId: string;
  engagementId: string;
  answer: string | null;
  answeredAt: string | null;
};

// Every question asked about this client's ledger, keyed by "entity:txnId".
//
// Feeds the uncategorised screen so it can show, beside each entry, either
// "asked, waiting" or the client's own words — which is the moment the firm can
// finally code it.
export async function ledgerAnswersForClient(
  clientId: string,
): Promise<Map<string, LedgerAnswer>> {
  const out = new Map<string, LedgerAnswer>();
  const supabase = await getServerSupabase();

  const { data: engagements, error: engErr } = await supabase
    .from("engagements")
    .select("id")
    .eq("client_id", clientId);
  if (engErr) throw engErr;
  const ids = (engagements ?? []).map((e) => (e as { id: string }).id);
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from("request_items")
    .select("id, engagement_id, ledger_txn, answer_text, answered_at")
    .in("engagement_id", ids)
    .eq("kind", "question")
    .not("ledger_txn", "is", null);
  if (error) {
    // Pre-migration: no questions exist, so "none asked" is the truth.
    if (isMissingSchema(error) || isUnknownEnum(error)) return out;
    throw error;
  }

  for (const row of data ?? []) {
    const r = row as {
      id: string;
      engagement_id: string;
      ledger_txn: unknown;
      answer_text: string | null;
      answered_at: string | null;
    };
    const ref = parseQuestionRef(r.ledger_txn);
    if (!ref) continue;
    out.set(keyOf(ref.entity, ref.txnId), {
      itemId: r.id,
      engagementId: r.engagement_id,
      answer: r.answer_text?.trim() ? r.answer_text : null,
      answeredAt: r.answered_at,
    });
  }
  return out;
}
