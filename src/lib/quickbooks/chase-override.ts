// "This receipt was asked for BECAUSE a transaction had none — attach it there."
//
// When a client uploads against an ordinary checklist item, the document becomes
// a draft and the accountant decides what it is. When they upload against a
// receipt-chase item, we already know: it is the paper behind one specific entry
// already in their books. Posting it as a new transaction would double-count the
// expense — the precise failure the register matcher exists to catch, arriving
// by a route the register matcher would not catch, because a receipt for a $340
// charge legitimately matches that $340 charge and the matcher would call it a
// confirm-worthy candidate rather than a certainty.
//
// So the chase carries its own answer. This resolves it into the SAME
// `{action:"attach"}` override the accountant's own "yes, that one" dialog
// produces — no new posting path, no second way to write to a ledger. The path
// this feeds is the one proven against a live company in PR #1092.
//
// THREE GUARDS, each of which is the difference between attaching a receipt and
// corrupting a client's books:
//
//   1. An explicit override always wins. If a human said "create it anyway" or
//      picked a different transaction, that is a decision, not a default.
//   2. The stored provider must match the provider being posted to. Vylan stores
//      a QuickBooks realm id and a Xero tenant id in one column with no
//      discriminator (see post.ts), so a client who switches providers would
//      otherwise send a QuickBooks transaction id to Xero — which will either
//      404 or, far worse, name a real and unrelated Xero transaction.
//   3. A malformed reference resolves to nothing, and nothing means the ordinary
//      review path. Failing to attach costs an accountant one click. Attaching
//      to the wrong entry costs them a client.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { parseLedgerRef, type LedgerTxnRef } from "@/lib/db/receipt-chase";
import type { PostMatchOverride } from "@/lib/quickbooks/post";

// The transaction this uploaded file was asked for, if it was a chase at all.
//
// Service-role: this runs inside the post orchestrator, which has already
// authorized the draft via getDraftForFile. Reading the item's own reference
// adds no reach beyond the file we are already acting on.
export async function chasedTransactionForFile(
  fileId: string,
): Promise<LedgerTxnRef | null> {
  const sb = getServiceRoleSupabase();
  const { data: file, error: fileErr } = await sb
    .from("uploaded_files")
    .select("request_item_id")
    .eq("id", fileId)
    .maybeSingle();
  if (fileErr || !file) return null;
  const itemId = (file as { request_item_id: string | null }).request_item_id;
  if (!itemId) return null;

  const { data: item, error } = await sb
    .from("request_items")
    .select("ledger_txn")
    .eq("id", itemId)
    .maybeSingle();
  if (error) {
    // Pre-migration: no chase can exist yet, so "not a chase" is the truthful
    // answer. (Creating a chase refuses outright — see receipt-chase.ts — so
    // there is no window where an item is chasing something we cannot read.)
    if (isMissingSchema(error)) return null;
    return null;
  }
  return parseLedgerRef((item as { ledger_txn?: unknown } | null)?.ledger_txn);
}

// Resolve the override to hand the post orchestrator. Pure, so the rules above
// are testable without a database.
export function chaseOverride(input: {
  // What the caller asked for. Any explicit override wins outright.
  supplied: PostMatchOverride | undefined;
  chased: LedgerTxnRef | null;
  // The provider this post is actually going to.
  postingTo: "quickbooks" | "xero";
}): PostMatchOverride | undefined {
  if (input.supplied) return input.supplied;
  const c = input.chased;
  if (!c) return undefined;
  if (c.provider !== input.postingTo) return undefined;
  return { action: "attach", qboId: c.txnId, entity: c.entity };
}
