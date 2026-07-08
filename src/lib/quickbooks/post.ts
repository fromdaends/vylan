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
  recordReceiptAttached,
} from "@/lib/db/quickbooks-suggestions";
import {
  getQuickbooksReadContext,
  type QuickbooksReadContext,
} from "@/lib/quickbooks/connection";
import {
  quickbooksCreate,
  quickbooksUploadAttachment,
  quickbooksTaxLinesEnabled,
  QuickbooksError,
  type QboTxnEntity,
} from "@/lib/quickbooks/client";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import { getUploadedFileById } from "@/lib/db/uploaded-files";
import { downloadObject } from "@/lib/storage";
import type { QuickbooksLists } from "@/lib/quickbooks/read";
import {
  effectiveMapping,
  effectiveDate,
  effectiveExpenseMode,
  effectiveSplit,
  effectiveLines,
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
  type ExpenseLine,
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
  // A real transaction date is required so QuickBooks auto-matches this to the
  // bank feed instead of dating it "today". draftNeedsInput already blocks
  // approval without one; this re-checks at post time (defense in depth, and it
  // catches a draft approved before this rule shipped).
  const effDate = effectiveDate(s, draft.resolved);
  if (effDate == null) {
    return { kind: "not_postable", ...base, problems: ["missing_date"] };
  }

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

  // EXPENSE line SPLIT: when the accountant opted to split across accounts, post
  // one line per item. Validate every line has an ACTIVE account, then build the
  // multi-line array. `expenseAccount` is the account the shared postability gate
  // + single-line builders use — the single pick, or (when split) the first
  // line's account as a representative so the vendor/amount/paid-from checks run.
  let expenseLines: ExpenseLine[] | undefined;
  let expenseAccount = eff.account;
  // Splitting only applies when tax-lines are ON: the line amounts are PRE-TAX
  // (they sum to the subtotal) and rely on QuickBooks adding the tax on top to
  // reach the gross total. With tax OFF we'd post the bare subtotal and DROP the
  // tax, so a split is ignored (single gross line) unless `tax` is applied.
  if (
    s.direction === "expense" &&
    tax != null &&
    effectiveSplit(s, draft.resolved)
  ) {
    const effLines = effectiveLines(s, draft.resolved);
    if (effLines.some((l) => l.account == null)) {
      return { kind: "not_postable", ...base, problems: ["missing_account"] };
    }
    if (lists?.accounts) {
      for (const l of effLines) {
        const a = lists.accounts.find((x) => x.id === l.account!.id);
        if (!a || !a.active) {
          return {
            kind: "not_postable",
            ...base,
            problems: ["account_inactive"],
          };
        }
      }
    }
    expenseLines = effLines.map((l) => ({
      amount: l.amount,
      accountId: l.account!.id,
    }));
    expenseAccount = effLines[0]!.account;
  }

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
      date: effDate,
      memo: "Posted from Vylan",
      tax,
    });
  } else if (effectiveExpenseMode(s, draft.resolved) === "purchase") {
    const problems = checkPurchasePostable({
      direction: s.direction,
      party: eff.party,
      account: expenseAccount,
      paymentAccount: eff.paymentAccount,
      amount: s.amount,
      lists: lists ?? null,
    });
    if (
      problems.length > 0 ||
      !eff.party ||
      !expenseAccount ||
      !eff.paymentAccount ||
      s.amount == null
    ) {
      return { kind: "not_postable", ...base, problems };
    }
    entity = "purchase";
    // PaymentType must agree with the paid-from account's type (Bank -> Cash,
    // Credit Card -> CreditCard). Derive it from the cached account — but NEVER
    // guess: if the cache is unavailable so we can't read the account's type,
    // refuse to post rather than send a Cash PaymentType that would contradict a
    // credit-card AccountRef (QuickBooks rejects that).
    const paAcct = (lists?.accounts ?? []).find(
      (a) => a.id === eff.paymentAccount!.id,
    );
    if (!paAcct) {
      return {
        kind: "not_postable",
        ...base,
        problems: ["payment_account_type_unknown"],
      };
    }
    payload = buildPurchasePayload({
      vendorId: eff.party.id,
      accountId: expenseAccount.id,
      paymentAccountId: eff.paymentAccount.id,
      paymentType: paymentTypeForAccount(paAcct.accountType),
      amount: s.amount,
      date: effDate,
      memo: "Posted from Vylan",
      tax,
      lines: expenseLines,
    });
  } else {
    const problems = checkBillPostable({
      direction: s.direction,
      party: eff.party,
      account: expenseAccount,
      amount: s.amount,
      lists: lists ?? null,
    });
    if (
      problems.length > 0 ||
      !eff.party ||
      !expenseAccount ||
      s.amount == null
    ) {
      return { kind: "not_postable", ...base, problems };
    }
    entity = "bill";
    payload = buildBillPayload({
      vendorId: eff.party.id,
      accountId: expenseAccount.id,
      amount: s.amount,
      date: effDate,
      memo: "Posted from Vylan",
      tax,
      lines: expenseLines,
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
    // Log to the server too (like the read/refresh paths do). `detail` carries the
    // intuit_tid at its front, so it reaches our logs even if the DB post_error
    // write below fails — and the post/write failure is exactly the case you'd
    // open an Intuit support ticket for.
    console.error(
      "[quickbooks] post failed:",
      e instanceof QuickbooksError ? e.code : "unknown",
      detail,
    );
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

  // Best-effort: attach the source receipt to the posted transaction so it lives
  // on the client's books as audit evidence (Dext/Hubdoc parity). NEVER affects
  // the post outcome — a failed/skipped attach just logs, records nothing, and the
  // post stands. A miss can be retried later from the card (attach-receipt route)
  // WITHOUT a void + re-post, because the outcome is recorded on the row.
  await attachReceiptToPostedDraft({
    ctx,
    entity,
    fileId,
    postedQboId: result.id,
  });

  return { kind: "posted", ...base, postedQboId: result.id, taxNote };
}

// Attach the source receipt to an ALREADY-POSTED transaction and record the
// outcome, shared by the post path (above) and the attach-receipt retry route.
// Best-effort + never throws: on success it stamps receipt_attached_at (so the
// card shows "Receipt attached" and the retry disappears); on any failure it logs
// and returns the detail so the caller can surface it (the retry route shows it on
// the card; the post path just logs — the post already stands). Because the
// outcome is persisted, a missed attach is recoverable without voiding the post.
export async function attachReceiptToPostedDraft(input: {
  ctx: QuickbooksReadContext;
  entity: QboTxnEntity;
  fileId: string;
  postedQboId: string;
}): Promise<{ kind: "attached" | "failed"; detail?: string }> {
  try {
    const file = await getUploadedFileById(input.fileId);
    if (!file) {
      // No source document to attach (deleted since the post). Nothing to record;
      // retrying can't help, so surface it plainly rather than logging an error.
      return { kind: "failed", detail: "Source document not found." };
    }
    const bytes = await downloadObject(file.storagePath);
    await quickbooksUploadAttachment(input.ctx, input.entity, input.postedQboId, {
      bytes,
      fileName: file.fileName,
      mime: file.mimeType,
    });
  } catch (e) {
    const detail =
      e instanceof QuickbooksError ? e.message : (e as Error).message;
    console.error(
      "[quickbooks] receipt attach failed (post still succeeded):",
      e instanceof QuickbooksError ? e.code : "unknown",
      detail,
    );
    return { kind: "failed", detail };
  }
  await recordReceiptAttached({
    uploadedFileId: input.fileId,
    postedQboId: input.postedQboId,
  });
  return { kind: "attached" };
}
