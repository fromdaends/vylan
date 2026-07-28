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
import {
  isClientXeroConnected,
  isClientXeroDemoOrg,
  readClientXeroPublishDefault,
} from "@/lib/db/xero";
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
  buildXeroInvoicePayload,
  buildXeroReceivePayload,
  xeroPostingReference,
  xeroUndoStatusFor,
  resolveXeroTaxApplication,
  xeroTaxDiscrepancyNote,
  type XeroExpenseLine,
  type XeroTaxApplication,
} from "@/lib/xero/post-transaction";
import {
  checkBillPostable,
  checkPurchasePostable,
  checkInvoicePostable,
} from "@/lib/quickbooks/post-transaction";
import {
  effectiveMapping,
  effectiveDate,
  effectiveExpenseMode,
  effectiveIncomeMode,
  effectivePublishStatus,
  effectiveSplit,
  effectiveLines,
} from "@/lib/quickbooks/draft-resolve";
import { postApprovedDraft, type PostOutcome } from "@/lib/quickbooks/post";
import { postingLineDescription } from "@/lib/quickbooks/suggest";
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
  if (!s) return "Invoices";
  // PAID either way is a bank transaction (SPEND out / RECEIVE in); UNPAID
  // either way is an invoice (ACCPAY owed by us / ACCREC owed to us). Undo
  // reads this to choose between deleting a bank transaction and voiding or
  // deleting an invoice, so income must be handled here or an undone sales
  // receipt would be sent to the wrong endpoint entirely.
  if (s.direction === "income") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return effectiveIncomeMode(s as any, draft.resolved as any) ===
      "salesreceipt"
      ? "BankTransactions" // RECEIVE
      : "Invoices"; // ACCREC
  }
  if (
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

  // SAFETY GATE: live posting is enabled for Xero DEMO companies only while the
  // posting path is hardened (register-match dedupe, recorded-provider undo
  // dispatch — see the go-live checklist). A real client's books can't be written
  // yet. Fails closed (isClientXeroDemoOrg returns false on any error).
  if (!(await isClientXeroDemoOrg(draft.firmId, draft.clientId))) {
    return {
      kind: "not_postable",
      ...base,
      problems: [],
      detail:
        "Xero posting is in testing — it's enabled for Xero Demo companies only right now.",
    };
  }

  const s = draft.suggestion;

  // Income posts too now: an UNPAID sale is an ACCREC invoice (no bank account
  // involved at all), a PAID sale a RECEIVE bank transaction against the
  // account it was deposited to. Only an UNKNOWN direction is unpostable —
  // we have no basis for choosing between a bill and an invoice.
  if (s.direction !== "expense" && s.direction !== "income") {
    return {
      kind: "not_postable",
      ...base,
      problems: ["not_expense"],
      detail:
        "We couldn't tell whether this is money in or money out. Set the direction first.",
    };
  }
  const isIncome = s.direction === "income";

  const eff = effectiveMapping(s, draft.resolved);
  const effDate = effectiveDate(s, draft.resolved);
  if (effDate == null) {
    return { kind: "not_postable", ...base, problems: ["missing_date"] };
  }

  // Human-facing detail on the posted entry: a "vendor — items" line description
  // and the document's own number as the Xero Reference (traceable to the paper).
  const lineDescription = postingLineDescription(
    eff.party?.name ?? s.partySource ?? null,
    s.lines,
  );
  // Reference is resolved per transaction KIND further down (once isPurchase is
  // known) — a bill with no document number gets a traceable VYL- fallback, a
  // bank transaction deliberately does not. See xeroPostingReference.

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

  // How this bill should land in Xero: the accountant's per-document pick, else
  // this client's remembered default, else AUTHORISED (unchanged behaviour).
  // effectivePublishStatus forces AUTHORISED for a paid expense — a SPEND bank
  // transaction has no draft or approval state in Xero.
  const publishStatus = effectivePublishStatus(
    s,
    draft.resolved,
    await readClientXeroPublishDefault(draft.firmId, draft.clientId),
  );

  // The document's own number when it has one; for a BILL with none, a
  // deterministic VYL-<fileId> so the transaction in Xero always traces back to
  // the paper in Vylan (a bank transaction keeps a blank reference — Xero's
  // reconciliation matcher reads this field).
  const reference = xeroPostingReference(
    s.reference,
    fileId,
    isPurchase ? "banktransaction" : "invoice",
  );

  let endpoint: XeroTxnEndpoint;
  let payload: Record<string, unknown>;

  if (isIncome) {
    // ── INCOME ────────────────────────────────────────────────────────────
    // Unpaid  -> ACCREC invoice   (the customer owes; no bank account needed)
    // Paid    -> RECEIVE bank txn (deposited to a bank account)
    const isSalesReceipt =
      effectiveIncomeMode(s, draft.resolved) === "salesreceipt";
    const problems = checkInvoicePostable({
      direction: s.direction,
      party: eff.party,
      item: eff.item,
      amount: s.amount,
      lists,
    });
    if (problems.length > 0 || !eff.party || !eff.item || s.amount == null) {
      return { kind: "not_postable", ...base, problems };
    }
    // Xero income lines reference an item by CODE (it carries the sales
    // account), with the income account as a fallback so an item that has no
    // code still produces a valid line. At least one must resolve.
    const itemCode = pctx?.itemCodeById.get(eff.item.id) ?? null;
    const incomeAccountCode =
      pctx?.itemIncomeAccountCodeById.get(eff.item.id) ?? null;
    if (!itemCode && !incomeAccountCode) {
      return {
        kind: "not_postable",
        ...base,
        problems: ["missing_item"],
        detail:
          "That product or service has no code and no income account in Xero.",
      };
    }
    const incomeCommon = {
      contactId: eff.party.id,
      itemCode,
      accountCode: incomeAccountCode,
      amount: s.amount,
      date: effDate,
      description: lineDescription,
      reference,
      tax,
    };
    if (isSalesReceipt) {
      // A deposit account is required and has no sensible default we could
      // invent — draftNeedsInput already blocks approval without one, so this
      // is the server-side backstop.
      if (!eff.paymentAccount) {
        return {
          kind: "not_postable",
          ...base,
          problems: ["missing_account"],
          detail: "Choose the bank account this was deposited to.",
        };
      }
      endpoint = "BankTransactions";
      payload = buildXeroReceivePayload({
        ...incomeCommon,
        bankAccountId: eff.paymentAccount.id,
      });
    } else {
      endpoint = "Invoices";
      payload = buildXeroInvoicePayload({
        ...incomeCommon,
        status: publishStatus,
      });
    }
  } else if (isPurchase) {
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
      description: lineDescription,
      reference,
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
      status: publishStatus,
      description: lineDescription,
      reference,
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
    // What undo needs to retract this correctly (VOIDED vs DELETED). A SPEND is
    // always AUTHORISED; only the bill path can be a draft.
    postedStatus: endpoint === "Invoices" ? publishStatus : "AUTHORISED",
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
      // Retract using what we ACTUALLY posted, never a re-derivation of the
      // draft's current state. Xero rejects VOIDED on a DRAFT or SUBMITTED
      // invoice (legal move: DELETED) and rejects DELETED on an AUTHORISED one,
      // so guessing here would throw, leave the bill in the client's books and
      // strand this row as "posted" with no way back except deleting it by hand
      // in Xero. postedStatus is null on a pre-0970 row, which was AUTHORISED.
      await xeroSetInvoiceStatus(
        ctx,
        draft.postedQboId,
        xeroUndoStatusFor(draft.postedStatus),
      );
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
