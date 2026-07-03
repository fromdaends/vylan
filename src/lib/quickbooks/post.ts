// Posting one approved draft to QuickBooks — the shared core used by BOTH the
// single-draft route and the bulk "Post all approved" route, so they behave
// identically (same gates, same idempotency, same conditional record). Returns
// an outcome the caller maps to HTTP / aggregates; the caller owns revalidation
// + audit so a bulk run can batch them.

import {
  getDraftForFile,
  recordDraftPosted,
  recordDraftPostError,
  recordDraftTaxNote,
} from "@/lib/db/quickbooks-suggestions";
import {
  getQuickbooksReadContext,
  type QuickbooksReadContext,
} from "@/lib/quickbooks/connection";
import {
  quickbooksCreate,
  quickbooksTaxLinesEnabled,
  QuickbooksError,
} from "@/lib/quickbooks/client";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import type { QuickbooksLists } from "@/lib/quickbooks/read";
import {
  effectiveMapping,
  effectiveExpenseMode,
} from "@/lib/quickbooks/draft-resolve";
import {
  buildBillPayload,
  checkBillPostable,
  buildInvoicePayload,
  checkInvoicePostable,
  buildPurchasePayload,
  checkPurchasePostable,
  paymentTypeForAccount,
  resolveTaxApplication,
  taxDiscrepancyNote,
  type TaxApplication,
  type PostabilityProblem,
  type InvoicePostabilityProblem,
  type PurchasePostabilityProblem,
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
  // Bill/Purchase (expense) or Invoice (income) postability problems — informational.
  problems?: (
    PostabilityProblem | InvoicePostabilityProblem | PurchasePostabilityProblem
  )[];
  // Set when a posted transaction's QuickBooks-computed tax differs from the
  // document's tax (a discrepancy worth the accountant's attention); null/absent
  // otherwise.
  taxNote?: string | null;
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

  // The connection context is needed up front: the company COUNTRY decides whether
  // we send the non-US GlobalTaxCalculation, so it shapes the payload.
  const ctx =
    opts && "ctx" in opts
      ? opts.ctx
      : await getQuickbooksReadContext(draft.firmId);
  if (!ctx) return { kind: "not_connected", ...base };

  // Decide whether to attach tax (net + tax code, QBO computes) or fall back to
  // the gross-no-tax line. Direction-agnostic — used by both builders below.
  const tax: TaxApplication | null = resolveTaxApplication({
    enabled: quickbooksTaxLinesEnabled(),
    country: ctx.companyCountry,
    taxCodeId: eff.taxCode?.id ?? null,
    subtotal: s.subtotal,
    total: s.amount,
    taxTotal: s.taxTotal,
  });

  // Branch: INCOME posts an Invoice (item line). An EXPENSE posts either a
  // PURCHASE (already paid — against a bank/credit-card account) or a BILL (unpaid
  // payable), decided by effectiveExpenseMode. All validate against CURRENT lists.
  let entity: "bill" | "invoice" | "purchase";
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
      tax,
    });
  } else if (effectiveExpenseMode(s, draft.resolved) === "purchase") {
    const problems = checkPurchasePostable({
      direction: s.direction,
      party: eff.party,
      account: eff.account,
      paymentAccount: eff.paymentAccount,
      amount: s.amount,
      lists: lists ?? null,
    });
    if (
      problems.length > 0 ||
      !eff.party ||
      !eff.account ||
      !eff.paymentAccount ||
      s.amount == null
    ) {
      return { kind: "not_postable", ...base, problems };
    }
    entity = "purchase";
    // PaymentType must agree with the paid-from account's type (Bank -> Cash,
    // Credit Card -> CreditCard); derive it from the cached account.
    const paAcct = (lists?.accounts ?? []).find(
      (a) => a.id === eff.paymentAccount!.id,
    );
    payload = buildPurchasePayload({
      vendorId: eff.party.id,
      accountId: eff.account.id,
      paymentAccountId: eff.paymentAccount.id,
      paymentType: paymentTypeForAccount(paAcct?.accountType ?? null),
      amount: s.amount,
      date: s.date,
      memo: "Posted from Vylan",
      tax,
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
      tax,
    });
  }

  const requestId = `${fileId}-${draft.postAttempt}`;

  let result: {
    id: string;
    syncToken: string;
    totalTax?: number | null;
    totalAmt?: number | null;
  };
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

  // When we posted WITH tax, compare QuickBooks' computed tax against the
  // document's tax and flag a material drift (best-effort, never affects the post
  // outcome). Always called on success — passing null when there's no drift clears
  // any stale note from a prior post of this draft.
  const taxNote = tax
    ? taxDiscrepancyNote({
        computedTax: result.totalTax ?? null,
        documentTax: s.taxTotal,
        computedTotal: result.totalAmt ?? null,
        documentTotal: s.amount,
      })
    : null;
  await recordDraftTaxNote({
    uploadedFileId: fileId,
    postedQboId: result.id,
    note: taxNote,
  });

  return { kind: "posted", ...base, postedQboId: result.id, taxNote };
}
