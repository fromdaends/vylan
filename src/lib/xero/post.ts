// Posting one approved draft to XERO (Phase 4b) — the orchestration that ties the
// pure builders (post-transaction.ts) to the write calls (write.ts). Mirrors
// quickbooks/post.ts but for Xero, and DELIBERATELY SIMPLER:
//   - EXPENSES only for now: a paid expense posts a BankTransaction SPEND, an
//     unpaid expense posts an Invoice ACCPAY. INCOME (Invoice/Receive) is deferred
//     — Xero's RECEIVE needs a deposit bank account we don't yet collect for
//     income, so the card keeps income Xero drafts on "posting coming soon".
//   - NO register-match (the smart "already in Xero?" dedupe) — the already_posted
//     guard prevents an app-level double-post; bank-feed dedup is a later add.
//
// Returns the SAME PostOutcome shape the QuickBooks path uses so the post route's
// outcome→HTTP mapping is shared. Idempotency-Key (fileId-postAttempt) makes an
// in-flight retry safe within Xero's ~6-minute window.

import {
  getDraftForFile,
  recordDraftPosted,
  recordDraftPostError,
  recordDraftTaxNote,
  recordReceiptAttached,
  recordDraftVoided,
} from "@/lib/db/quickbooks-suggestions";
import { isClientXeroConnected } from "@/lib/db/xero";
import { readXeroPostingContext } from "@/lib/db/xero-cache";
import { getXeroReadContext, type XeroReadContext } from "@/lib/xero/connection";
import { XeroError } from "@/lib/xero/client";
import {
  xeroCreateInvoice,
  xeroCreateBankTransaction,
  xeroSetInvoiceStatus,
  xeroDeleteBankTransaction,
  xeroUploadAttachment,
  type XeroTxnEndpoint,
  type XeroCreatedTxn,
} from "@/lib/xero/write";
import {
  buildXeroBillPayload,
  buildXeroSpendPayload,
  resolveXeroTaxApplication,
  xeroTaxDiscrepancyNote,
  type XeroExpenseLine,
  type XeroTaxApplication,
} from "@/lib/xero/post-transaction";
import {
  checkBillPostable,
  checkPurchasePostable,
} from "@/lib/quickbooks/post-transaction";
import {
  effectiveMapping,
  effectiveDate,
  effectiveExpenseMode,
  effectiveSplit,
  effectiveLines,
} from "@/lib/quickbooks/draft-resolve";
import { postApprovedDraft, type PostOutcome } from "@/lib/quickbooks/post";
import { getUploadedFileById } from "@/lib/db/uploaded-files";
import { downloadObject } from "@/lib/storage";

// Dispatch a post to the right provider. The post route calls this; a Xero-
// connected client's draft posts to Xero, everyone else to QuickBooks (its
// register-match `match` override is ignored by the Xero path). Both return the
// same PostOutcome so the route's HTTP mapping is provider-neutral.
export async function postApprovedDraftForFile(
  fileId: string,
  posterId: string,
  opts?: { match?: unknown },
): Promise<PostOutcome> {
  const draft = await getDraftForFile(fileId);
  if (!draft) return { kind: "not_found", engagementId: null, firmId: null };
  if (
    draft.clientId &&
    draft.firmId &&
    (await isClientXeroConnected(draft.firmId, draft.clientId))
  ) {
    return postApprovedXeroDraft(fileId, posterId);
  }
  // QuickBooks (unchanged) — forward the register-match override.
  return postApprovedDraft(
    fileId,
    posterId,
    opts as Parameters<typeof postApprovedDraft>[2],
  );
}

// Which Xero endpoint a draft's transaction lives under, given its expense mode.
// (Income is deferred, so this only distinguishes paid SPEND vs unpaid ACCPAY.)
function xeroEndpointForDraft(draft: {
  suggestion: { direction: string } | null;
  resolved: unknown;
}): XeroTxnEndpoint {
  const s = draft.suggestion;
  if (
    s &&
    s.direction === "expense" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    effectiveExpenseMode(s as any, draft.resolved as any) === "purchase"
  ) {
    return "BankTransactions"; // SPEND
  }
  return "Invoices"; // ACCPAY (bill)
}

// Post one APPROVED EXPENSE draft to Xero. Income returns not_postable (the card
// gates it out, so this is defense-in-depth).
export async function postApprovedXeroDraft(
  fileId: string,
  posterId: string,
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
  if (!draft.clientId || !draft.firmId) return { kind: "not_connected", ...base };

  const s = draft.suggestion;

  // Income posting to Xero is deferred (RECEIVE needs a deposit bank account we
  // don't collect for income). The card keeps income Xero drafts on the
  // "coming soon" note; this guard is the server-side backstop.
  if (s.direction !== "expense") {
    return {
      kind: "not_postable",
      ...base,
      problems: ["not_expense"],
      detail: "Posting income to Xero is coming soon.",
    };
  }

  const eff = effectiveMapping(s, draft.resolved);
  const effDate = effectiveDate(s, draft.resolved);
  if (effDate == null) {
    return { kind: "not_postable", ...base, problems: ["missing_date"] };
  }

  // Posting context: the QuickbooksLists (for the provider-neutral active checks)
  // + the GUID→code maps Xero line items need.
  const pctx = await readXeroPostingContext(draft.firmId, draft.clientId);
  const lists = pctx?.lists ?? null;

  const ctx = await getXeroReadContext(draft.firmId, draft.clientId);
  if (!ctx) return { kind: "not_connected", ...base };

  // Tax: the approved taxCode.id IS the Xero TaxType (tax rates key on TaxType).
  const tax: XeroTaxApplication | null = resolveXeroTaxApplication({
    enabled: true,
    taxType: eff.taxCode?.id ?? null,
    subtotal: s.subtotal,
    total: s.amount,
    taxTotal: s.taxTotal,
  });

  // Resolve an account GUID → its Xero AccountCode (required on every line).
  const codeFor = (accountId: string): string | null =>
    pctx?.accountCodeById.get(accountId) ?? null;

  // SPLIT across accounts (only meaningful WITH tax — pre-tax line amounts). Each
  // line must have an active account WITH a code.
  let expenseLines: XeroExpenseLine[] | undefined;
  let expenseAccount = eff.account;
  if (tax != null && effectiveSplit(s, draft.resolved)) {
    const effLines = effectiveLines(s, draft.resolved);
    if (effLines.some((l) => l.account == null)) {
      return { kind: "not_postable", ...base, problems: ["missing_account"] };
    }
    const out: XeroExpenseLine[] = [];
    for (const l of effLines) {
      const acct = lists?.accounts?.find((a) => a.id === l.account!.id);
      if (!acct || !acct.active) {
        return { kind: "not_postable", ...base, problems: ["account_inactive"] };
      }
      const code = codeFor(l.account!.id);
      if (!code) {
        return {
          kind: "not_postable",
          ...base,
          problems: ["missing_account"],
          detail: "A split account has no code in Xero.",
        };
      }
      out.push({ amount: l.amount, accountCode: code });
    }
    expenseLines = out;
    expenseAccount = effLines[0]!.account;
  }

  const isPurchase = effectiveExpenseMode(s, draft.resolved) === "purchase";

  let endpoint: XeroTxnEndpoint;
  let payload: Record<string, unknown>;

  if (isPurchase) {
    // Paid expense → SPEND bank transaction. Needs the paid-from bank account.
    const problems = checkPurchasePostable({
      direction: s.direction,
      party: eff.party,
      account: expenseAccount,
      paymentAccount: eff.paymentAccount,
      amount: s.amount,
      lists,
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
    const accountCode = codeFor(expenseAccount.id);
    if (!accountCode) {
      return {
        kind: "not_postable",
        ...base,
        problems: ["missing_account"],
        detail: "The expense account has no code in Xero.",
      };
    }
    endpoint = "BankTransactions";
    payload = buildXeroSpendPayload({
      contactId: eff.party.id,
      accountCode,
      bankAccountId: eff.paymentAccount.id, // Xero BankAccount.AccountID (GUID)
      amount: s.amount,
      date: effDate,
      tax,
      lines: expenseLines,
    });
  } else {
    // Unpaid expense → ACCPAY bill.
    const problems = checkBillPostable({
      direction: s.direction,
      party: eff.party,
      account: expenseAccount,
      amount: s.amount,
      lists,
    });
    if (problems.length > 0 || !eff.party || !expenseAccount || s.amount == null) {
      return { kind: "not_postable", ...base, problems };
    }
    const accountCode = codeFor(expenseAccount.id);
    if (!accountCode) {
      return {
        kind: "not_postable",
        ...base,
        problems: ["missing_account"],
        detail: "The expense account has no code in Xero.",
      };
    }
    endpoint = "Invoices";
    payload = buildXeroBillPayload({
      contactId: eff.party.id,
      accountCode,
      amount: s.amount,
      date: effDate,
      tax,
      lines: expenseLines,
    });
  }

  const idempotencyKey = `${fileId}-${draft.postAttempt}`;

  let created: XeroCreatedTxn;
  try {
    created =
      endpoint === "BankTransactions"
        ? await xeroCreateBankTransaction(ctx, payload, idempotencyKey)
        : await xeroCreateInvoice(ctx, payload, idempotencyKey);
  } catch (e) {
    const detail = e instanceof XeroError ? e.message : (e as Error).message;
    // A 401 means the access token was rejected even though we thought it fresh —
    // the org's consent was revoked in Xero. Nothing was created (auth failed
    // before the write), so it's safe to ask for a reconnect.
    if (e instanceof XeroError && e.status === 401) {
      return {
        kind: "reconnect_required",
        ...base,
        detail:
          "Your Xero connection was disconnected. Please reconnect Xero and try again.",
      };
    }
    console.error(
      "[xero] post failed:",
      e instanceof XeroError ? e.code : "unknown",
      detail,
    );
    await recordDraftPostError({ uploadedFileId: fileId, error: detail });
    return { kind: "post_failed", ...base, detail };
  }

  const recorded = await recordDraftPosted({
    uploadedFileId: fileId,
    expectedAttempt: draft.postAttempt,
    postedQboId: created.id,
    postedSyncToken: "0", // Xero has no SyncToken
    posterId,
    postedRealmId: ctx.tenantId, // the Xero org (tenant) it posted under
  });
  if (recorded === "conflict") return { kind: "conflict", ...base };
  if (recorded !== "ok") {
    return {
      kind: "record_failed",
      ...base,
      postedQboId: created.id,
      detail: "Posted to Xero but couldn't save it.",
    };
  }

  // Tax discrepancy note (best-effort; never affects the outcome). Always called
  // on a taxed post so a stale note from a prior post is cleared (null).
  const taxNote = tax
    ? xeroTaxDiscrepancyNote({
        computedTax: created.totalTax,
        documentTax: s.taxTotal,
        computedTotal: created.total,
        documentTotal: s.amount,
      })
    : null;
  await recordDraftTaxNote({
    uploadedFileId: fileId,
    postedQboId: created.id,
    note: taxNote,
  });

  // Best-effort: attach the source receipt to the posted transaction.
  await attachReceiptToPostedXeroDraft({
    ctx,
    endpoint,
    fileId,
    postedXeroId: created.id,
  });

  return { kind: "posted", ...base, postedQboId: created.id, taxNote };
}

// Attach the source receipt to an already-posted Xero transaction + record it.
// Best-effort + never throws (mirrors the QuickBooks helper): the post stands
// even if the attach fails; a miss can be retried from the card.
export async function attachReceiptToPostedXeroDraft(input: {
  ctx: XeroReadContext;
  endpoint: XeroTxnEndpoint;
  fileId: string;
  postedXeroId: string;
}): Promise<{ kind: "attached" | "failed"; detail?: string }> {
  try {
    const file = await getUploadedFileById(input.fileId);
    if (!file) return { kind: "failed", detail: "Source document not found." };
    const bytes = await downloadObject(file.storagePath);
    await xeroUploadAttachment(input.ctx, input.endpoint, input.postedXeroId, {
      bytes,
      fileName: file.fileName,
      mime: file.mimeType,
    });
  } catch (e) {
    const detail = e instanceof XeroError ? e.message : (e as Error).message;
    console.error(
      "[xero] receipt attach failed (post still succeeded):",
      e instanceof XeroError ? e.code : "unknown",
      detail,
    );
    return { kind: "failed", detail };
  }
  await recordReceiptAttached({
    uploadedFileId: input.fileId,
    postedQboId: input.postedXeroId,
  });
  return { kind: "attached" };
}

export type XeroUndoResult =
  | { kind: "ok"; engagementId: string; firmId: string; postedXeroId: string }
  | { kind: "not_found" }
  | { kind: "not_enabled"; engagementId: string }
  | { kind: "not_posted"; engagementId: string }
  | { kind: "not_connected"; engagementId: string }
  | { kind: "void_failed"; engagementId: string; detail?: string }
  | { kind: "record_failed"; engagementId: string };

// Undo a posted Xero draft: delete the BankTransaction (SPEND) or void the
// Invoice (ACCPAY, AUTHORISED → VOIDED), then return the draft to 'approved' with
// a bumped attempt so a re-post uses a fresh idempotency key. Xero never
// register-matches, so there is no "unlink a pre-existing txn" case here.
export async function undoXeroPost(fileId: string): Promise<XeroUndoResult> {
  const draft = await getDraftForFile(fileId);
  if (!draft) return { kind: "not_found" };
  const eng = draft.engagementId;
  if (!draft.postReady) return { kind: "not_enabled", engagementId: eng };
  if (draft.status !== "posted" || !draft.postedQboId) {
    return { kind: "not_posted", engagementId: eng };
  }
  if (!draft.clientId || !draft.firmId) {
    return { kind: "not_connected", engagementId: eng };
  }
  const ctx = await getXeroReadContext(draft.firmId, draft.clientId);
  if (!ctx) return { kind: "not_connected", engagementId: eng };

  const endpoint = xeroEndpointForDraft(draft);
  try {
    if (endpoint === "BankTransactions") {
      await xeroDeleteBankTransaction(ctx, draft.postedQboId);
    } else {
      // An AUTHORISED bill with no payments → VOIDED (Xero rejects DELETE on it).
      await xeroSetInvoiceStatus(ctx, draft.postedQboId, "VOIDED");
    }
  } catch (e) {
    const detail = e instanceof XeroError ? e.message : (e as Error).message;
    await recordDraftPostError({
      uploadedFileId: fileId,
      error: `Undo failed: ${detail}`,
    });
    return { kind: "void_failed", engagementId: eng, detail };
  }

  const ok = await recordDraftVoided({
    uploadedFileId: fileId,
    nextAttempt: draft.postAttempt + 1,
  });
  if (!ok) return { kind: "record_failed", engagementId: eng };
  return {
    kind: "ok",
    engagementId: eng,
    firmId: draft.firmId,
    postedXeroId: draft.postedQboId,
  };
}

// Retry attaching the receipt to a posted Xero draft (the card's attach-retry).
// Self-contained: fetches the draft, resolves the endpoint, attaches, records.
export type XeroAttachResult =
  | { kind: "attached"; engagementId: string; alreadyAttached?: boolean }
  | { kind: "not_found" }
  | { kind: "not_enabled"; engagementId: string }
  | { kind: "not_posted"; engagementId: string }
  | { kind: "not_connected"; engagementId: string }
  | { kind: "failed"; engagementId: string; detail?: string };

export async function attachXeroReceipt(fileId: string): Promise<XeroAttachResult> {
  const draft = await getDraftForFile(fileId);
  if (!draft) return { kind: "not_found" };
  const eng = draft.engagementId;
  if (!draft.attachReady) return { kind: "not_enabled", engagementId: eng };
  if (draft.status !== "posted" || !draft.postedQboId) {
    return { kind: "not_posted", engagementId: eng };
  }
  if (draft.receiptAttachedAt) {
    return { kind: "attached", engagementId: eng, alreadyAttached: true };
  }
  if (!draft.clientId || !draft.firmId) {
    return { kind: "not_connected", engagementId: eng };
  }
  const ctx = await getXeroReadContext(draft.firmId, draft.clientId);
  if (!ctx) return { kind: "not_connected", engagementId: eng };

  const outcome = await attachReceiptToPostedXeroDraft({
    ctx,
    endpoint: xeroEndpointForDraft(draft),
    fileId,
    postedXeroId: draft.postedQboId,
  });
  if (outcome.kind !== "attached") {
    return { kind: "failed", engagementId: eng, detail: outcome.detail };
  }
  return { kind: "attached", engagementId: eng };
}
