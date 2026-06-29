// Posting one approved draft to QuickBooks — the shared core used by BOTH the
// single-draft route and the bulk "Post all approved" route, so they behave
// identically (same gates, same idempotency, same conditional record). Returns
// an outcome the caller maps to HTTP / aggregates; the caller owns revalidation
// + audit so a bulk run can batch them.

import {
  getDraftForFile,
  recordDraftPosted,
  recordDraftPostError,
} from "@/lib/db/quickbooks-suggestions";
import {
  getQuickbooksReadContext,
  type QuickbooksReadContext,
} from "@/lib/quickbooks/connection";
import { quickbooksCreate, QuickbooksError } from "@/lib/quickbooks/client";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import type { QuickbooksLists } from "@/lib/quickbooks/read";
import { effectiveMapping } from "@/lib/quickbooks/draft-resolve";
import {
  buildBillPayload,
  checkBillPostable,
  buildInvoicePayload,
  checkInvoicePostable,
  type PostabilityProblem,
  type InvoicePostabilityProblem,
} from "@/lib/quickbooks/post-transaction";

export type PostOutcomeKind =
  | "posted"
  | "already_posted"
  | "not_found"
  | "not_enabled"
  | "not_approved"
  | "not_postable"
  | "not_connected"
  | "post_failed"
  | "conflict"
  | "record_failed";

export type PostOutcome = {
  kind: PostOutcomeKind;
  engagementId: string | null;
  firmId: string | null;
  postedQboId?: string | null;
  detail?: string;
  // Bill (expense) or Invoice (income) postability problems — informational.
  problems?: (PostabilityProblem | InvoicePostabilityProblem)[];
};

// Post one approved EXPENSE draft as a QuickBooks Bill. Idempotent + safe:
//  - schema gate (postReady): never call QuickBooks if we can't record it;
//  - already-posted → no-op success;
//  - stable requestid (fileId-postAttempt) → a retry/race returns the original;
//  - conditional record (status='approved' AND post_attempt unchanged) → never
//    records a voided/reopened draft as posted.
// `opts.lists` / `opts.ctx` let a bulk caller fetch the lists + connection
// context ONCE and reuse them across drafts (pass undefined to fetch per call).
export async function postApprovedDraft(
  fileId: string,
  posterId: string,
  opts?: {
    lists?: QuickbooksLists | null;
    ctx?: QuickbooksReadContext | null;
  },
): Promise<PostOutcome> {
  const draft = await getDraftForFile(fileId);
  if (!draft || !draft.suggestion) {
    return { kind: "not_found", engagementId: null, firmId: null };
  }
  const base = { engagementId: draft.engagementId, firmId: draft.firmId };

  if (!draft.postReady) return { kind: "not_enabled", ...base };
  if (draft.status === "posted" || draft.postedQboId) {
    return { kind: "already_posted", ...base, postedQboId: draft.postedQboId };
  }
  if (draft.status !== "approved") return { kind: "not_approved", ...base };

  const s = draft.suggestion;
  const eff = effectiveMapping(s, draft.resolved);

  const lists =
    opts && "lists" in opts ? opts.lists : await readCachedQuickbooksLists();

  // Branch by direction: an EXPENSE posts a Bill (account line), INCOME posts an
  // Invoice (item line). Both validate against the firm's CURRENT lists.
  let entity: "bill" | "invoice";
  let payload: Record<string, unknown>;
  if (s.direction === "income") {
    const problems = checkInvoicePostable({
      direction: s.direction,
      party: eff.party,
      item: eff.item,
      amount: s.amount,
      lists: lists ?? null,
    });
    if (problems.length > 0 || !eff.party || !eff.item || s.amount == null) {
      return { kind: "not_postable", ...base, problems };
    }
    entity = "invoice";
    payload = buildInvoicePayload({
      customerId: eff.party.id,
      itemId: eff.item.id,
      amount: s.amount,
      date: s.date,
      memo: "Posted from Vylan",
    });
  } else {
    const problems = checkBillPostable({
      direction: s.direction,
      party: eff.party,
      account: eff.account,
      amount: s.amount,
      lists: lists ?? null,
    });
    if (problems.length > 0 || !eff.party || !eff.account || s.amount == null) {
      return { kind: "not_postable", ...base, problems };
    }
    entity = "bill";
    payload = buildBillPayload({
      vendorId: eff.party.id,
      accountId: eff.account.id,
      amount: s.amount,
      date: s.date,
      memo: "Posted from Vylan",
    });
  }

  const ctx =
    opts && "ctx" in opts
      ? opts.ctx
      : await getQuickbooksReadContext(draft.firmId);
  if (!ctx) return { kind: "not_connected", ...base };

  const requestId = `${fileId}-${draft.postAttempt}`;

  let result: { id: string; syncToken: string };
  try {
    result = await quickbooksCreate(ctx, entity, payload, requestId);
  } catch (e) {
    const detail =
      e instanceof QuickbooksError ? e.message : (e as Error).message;
    await recordDraftPostError({ uploadedFileId: fileId, error: detail });
    return { kind: "post_failed", ...base, detail };
  }

  const recorded = await recordDraftPosted({
    uploadedFileId: fileId,
    expectedAttempt: draft.postAttempt,
    postedQboId: result.id,
    postedSyncToken: result.syncToken,
    posterId,
  });
  if (recorded === "conflict") return { kind: "conflict", ...base };
  if (recorded !== "ok") {
    return {
      kind: "record_failed",
      ...base,
      postedQboId: result.id,
      detail: "Posted to QuickBooks but couldn't save it.",
    };
  }
  return { kind: "posted", ...base, postedQboId: result.id };
}
