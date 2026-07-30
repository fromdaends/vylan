// Posting one approved draft to XERO (Phase 4b) — the orchestration that ties the
// pure builders (post-transaction.ts) to the write calls (write.ts). Mirrors
// quickbooks/post.ts but for Xero:
//   - BOTH directions post: a paid expense posts a BankTransaction SPEND, an
//     unpaid expense an Invoice ACCPAY, a paid sale a RECEIVE, an unpaid sale an
//     ACCREC. Only an UNKNOWN-direction draft is unpostable.
//   - REGISTER-MATCH is in place (register-match.ts): before creating anything we
//     check whether the client's books already hold this transaction (bank feed,
//     their own bookkeeper) and attach the receipt to it instead of creating a
//     duplicate. The already_posted guard only stops re-posting the same FILE.
//
// LIVE FOR REAL BOOKS. Posting was gated to Xero DEMO companies while this path
// was hardened; the founder lifted that gate once register-match landed, so every
// connected org — including a real client's live books — is writable from here.
// That makes the pre-create duplicate check load-bearing rather than a nicety: it
// is the only thing standing between a re-uploaded receipt and an overstated
// expense in a real ledger. Keep its fail-closed/fail-open split intact (an
// EXPLICIT accountant match fails closed, the AUTOMATIC check fails open).
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
  readClientXeroPublishDefault,
  readClientXeroBaseCurrency,
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
  xeroCurrencyCodeFor,
  xeroEndpointForDraft,
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
  isPostableDate,
  effectiveExpenseMode,
  effectiveIncomeMode,
  effectivePublishStatus,
  effectiveSplit,
  effectiveLines,
} from "@/lib/quickbooks/draft-resolve";
import {
  postApprovedDraft,
  type PostOutcome,
  type PostMatchOverride,
} from "@/lib/quickbooks/post";
import type { RegisterCandidate } from "@/lib/quickbooks/register-match";
import type { QboTxnEntity } from "@/lib/quickbooks/client";
import {
  searchXeroRegister,
  checkXeroRegister,
  xeroSearchEntities,
} from "@/lib/xero/register-match";
import { listFirmPostedQboIds } from "@/lib/db/quickbooks-suggestions";
import { postingLineDescription } from "@/lib/quickbooks/suggest";
import { getUploadedFileById } from "@/lib/db/uploaded-files";
import { downloadObject } from "@/lib/storage";

// Dispatch a post to the right provider. The post route calls this; a Xero-
// connected client's draft posts to Xero, everyone else to QuickBooks. Both honour
// the register-match `match` override and return the same PostOutcome, so the
// route's HTTP mapping is provider-neutral.
//
// ⚠️ Dispatch reads the client's CURRENT connection, not the provider the draft was
// actually posted to (posted_realm_id holds a QBO realmId and a Xero tenantId in
// one column, with no provider discriminator). Undo has the same shape. A client
// who switches providers after posting therefore sends the wrong id to the wrong
// API. Pre-existing and tracked separately from the demo-gate lift.
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
    return postApprovedXeroDraft(
      fileId,
      posterId,
      opts as { match?: PostMatchOverride } | undefined,
    );
  }
  // QuickBooks (unchanged) — forward the register-match override.
  return postApprovedDraft(
    fileId,
    posterId,
    opts as Parameters<typeof postApprovedDraft>[2],
  );
}

// Post one APPROVED EXPENSE draft to Xero. Income returns not_postable (the card
// gates it out, so this is defense-in-depth).
export async function postApprovedXeroDraft(
  fileId: string,
  posterId: string,
  opts?: { match?: PostMatchOverride },
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
  // On an EXPENSE the description names the supplier and what was bought. On a
  // SALES INVOICE that would print the CUSTOMER'S OWN NAME as the description of
  // the work they are being billed for — which is what landed in Xero: a line
  // reading "Eastside Club" against $6,000 of development. suggestLines is
  // expense-split machinery and returns nothing for income, so the party name
  // was all that remained. The product being sold is the right description.
  const lineDescription =
    s.direction === "income"
      ? (eff.item?.name ??
        postingLineDescription(eff.party?.name ?? s.partySource ?? null, s.lines))
      : postingLineDescription(
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
  // A document in a DIFFERENT currency from the client's books must say so, or
  // Xero records the figure against its own currency and the number looks right
  // while being wrong.
  const orgCurrency = await readClientXeroBaseCurrency(
    draft.firmId,
    draft.clientId,
  );
  const currencyCode = xeroCurrencyCodeFor(s.currency, orgCurrency);

  // The accountant's tracking picks, as the {category, option} pairs Xero wants.
  // Entries the accountant cleared (null) are dropped rather than sent empty.
  const trackingPairs = Object.entries(draft.resolved?.tracking ?? {})
    .flatMap(([categoryId, ref]) =>
      ref?.id ? [{ categoryId, optionId: ref.id }] : [],
    )
    .slice(0, 2);

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

  // ── Don't create what the books already have ─────────────────────────────
  //
  // The client's bank feed, or their bookkeeper, may have recorded this days
  // before the receipt ever reached Vylan. Creating it again puts the same
  // expense in the books twice, and nothing downstream catches it: both entries
  // look individually correct, and it surfaces at year end as an overstated
  // expense and an overstated tax claim.
  //
  // Amount (to the penny) + date (±5 days), NOT the party name — what a receipt
  // prints rarely matches the descriptor a bank feed recorded. One clear
  // candidate attaches the receipt to it and creates nothing; anything less
  // certain asks the accountant.
  const draftEntity: QboTxnEntity = isIncome
    ? effectiveIncomeMode(s, draft.resolved) === "salesreceipt"
      ? "salesreceipt"
      : "invoice"
    : isPurchase
      ? "purchase"
      : "bill";
  const searchEntities = xeroSearchEntities(isIncome ? "income" : "expense");

  // EXPLICIT ATTACH — the accountant already answered "this IS the existing
  // one". FAILS CLOSED: if the pick can't be re-verified we must not fall
  // through to a create, or we'd manufacture the very duplicate they told us
  // already exists. (The automatic check below fails OPEN, deliberately.)
  if (opts?.match?.action === "attach") {
    // Captured while the union is still narrowed — the narrowing is lost across
    // the awaits below, since opts is a parameter.
    const pickedId = opts.match.qboId;
    const pickedEntity = opts.match.entity;
    // Without the matched_qbo_type column a match can't be marked as matched,
    // and undo would DELETE a transaction Vylan never created. Refuse rather
    // than record a match we can't retract correctly.
    if (!draft.matchReady) {
      return {
        kind: "post_failed",
        ...base,
        detail: "Couldn't confirm this match in Xero. Please refresh and try again.",
      };
    }
    const excludeIds = await listFirmPostedQboIds(draft.firmId, ctx.tenantId);
    const search =
      excludeIds == null
        ? null
        : await searchXeroRegister(ctx, {
            date: effDate,
            amountCents: Math.round((s.amount ?? 0) * 100),
            entities: searchEntities,
            documentCurrency: s.currency,
            orgCurrency,
          });
    if (search == null || search.readFailed) {
      // Couldn't run a fresh search. We can neither confirm the pick nor safely
      // create — a soft failure the accountant retries, never a silent
      // duplicate.
      return {
        kind: "post_failed",
        ...base,
        detail: "Couldn't confirm this match in Xero. Please try again.",
      };
    }
    // Re-validated against the FRESH search — never trust an id from the
    // client. Gone or changed → re-ask with the current candidates.
    const attachTo =
      search.candidates.find(
        (c) =>
          !excludeIds!.has(c.qboId) &&
          c.qboId === pickedId &&
          (pickedEntity == null || c.entity === pickedEntity),
      ) ?? null;
    if (!attachTo) {
      return {
        kind: "needs_match_confirmation",
        ...base,
        matchCandidates: search.candidates.filter(
          (c) => !excludeIds!.has(c.qboId),
        ),
      };
    }
    return recordXeroMatch({ attachTo, fileId, draft, posterId, ctx, base });
  }

  // AUTOMATIC pre-create check — FAIL-OPEN: anything unexpected logs and falls
  // through to the normal create, because the duplicate check must never block
  // a legitimate post. Skipped when the accountant already chose "post a new
  // one" (match.action === "create"), and pre-migration-0510.
  if (!opts?.match && draft.matchReady && s.amount != null) {
    try {
      // Exclude what Vylan itself posted for this firm in THIS organisation,
      // read fresh per post so a draft posted seconds ago (mid-bulk) is already
      // excluded. A null read means "couldn't check", not "none": skip matching
      // rather than risk attaching to a transaction Vylan created.
      const excludeIds = await listFirmPostedQboIds(draft.firmId, ctx.tenantId);
      if (excludeIds != null) {
        const { verdict, candidates } = await checkXeroRegister(ctx, {
          date: effDate,
          amountCents: Math.round(s.amount * 100),
          entities: searchEntities,
          documentCurrency: s.currency,
          orgCurrency,
          excludeIds,
          draftEntity,
          draftVendorId: eff.party?.id ?? null,
          draftVendorNames: [eff.party?.name ?? null, s.partySource ?? null],
        });
        if (verdict.kind === "confirm") {
          return {
            kind: "needs_match_confirmation",
            ...base,
            matchCandidates: candidates,
          };
        }
        if (verdict.kind === "clear") {
          return recordXeroMatch({
            attachTo: verdict.candidate,
            fileId,
            draft,
            posterId,
            ctx,
            base,
          });
        }
      }
    } catch (e) {
      // Fail-open: the register read is best-effort, and posting is not.
      console.error(
        "[xero] register match check failed (posting anyway):",
        e instanceof XeroError ? `${e.code} ${e.message}` : (e as Error).message,
      );
    }
  }

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
      dueDate: isPostableDate(s.dueDate) ? s.dueDate : null,
      itemCode,
      accountCode: incomeAccountCode,
      amount: s.amount,
      date: effDate,
      description: lineDescription,
      reference,
      currencyCode,
      tracking: trackingPairs,
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
      currencyCode,
      tracking: trackingPairs,
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
      // Read off the document ("Net 30", an explicit due date). Absent, the
      // builder falls back to the transaction date as before.
      dueDate: isPostableDate(s.dueDate) ? s.dueDate : null,
      status: publishStatus,
      description: lineDescription,
      reference,
      currencyCode,
      tracking: trackingPairs,
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
    // 1040: WHICH system, not just which company. posted_realm_id alone can't say
    // — it holds a Xero tenantId and a QuickBooks realmId in one column.
    postedProvider: "xero",
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
  | {
      kind: "ok";
      engagementId: string;
      firmId: string;
      postedXeroId: string;
      // True when the draft was MATCHED: nothing was deleted or voided in Xero,
      // the link was simply removed on our side.
      unlinkedMatch?: boolean;
    }
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

  // A MATCHED draft points at a transaction that was ALREADY in the client's
  // books — their bank feed or their bookkeeper made it, not Vylan. Undo must
  // therefore only UNLINK on our side: the draft returns to Approved, and the
  // transaction (with any receipt already attached to it in Xero) stays exactly
  // where it was. Deleting or voiding here would remove a real entry from a
  // client's ledger on a button that says "Undo".
  const matched = draft.matchedQboType != null;

  const endpoint = xeroEndpointForDraft(draft);
  try {
    if (matched) {
      // Nothing to retract in Xero — the transaction was never ours.
    } else if (endpoint === "BankTransactions") {
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
    unlinkedMatch: matched || undefined,
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


// Record a draft as posted against a transaction that was ALREADY in the books,
// and attach the source document to it.
//
// Nothing is created. The draft points at the existing Xero transaction, and
// matchedQboType marks it as matched rather than created — which is what makes
// Undo UNLINK it instead of deleting a transaction Vylan never made.
async function recordXeroMatch(input: {
  attachTo: RegisterCandidate;
  fileId: string;
  draft: { postAttempt: number; engagementId: string; firmId: string };
  posterId: string;
  ctx: XeroReadContext;
  base: { engagementId: string; firmId: string };
}): Promise<PostOutcome> {
  const { attachTo, fileId, draft, posterId, ctx, base } = input;
  const recorded = await recordDraftPosted({
    uploadedFileId: fileId,
    expectedAttempt: draft.postAttempt,
    postedQboId: attachTo.qboId,
    postedSyncToken: "0", // Xero has no SyncToken
    posterId,
    postedRealmId: ctx.tenantId,
    postedProvider: "xero", // 1040 — a MATCHED row still lives in Xero
    matchedQboType: attachTo.entity,
    // A matched transaction was not created by us, so there is no publish
    // status of ours to undo — the recorded status stays null, which undo
    // reads as AUTHORISED and, combined with matchedQboType, unlinks.
    postedStatus: null,
  });
  if (recorded === "conflict") return { kind: "conflict", ...base };
  if (recorded !== "ok") {
    return { kind: "record_failed", ...base };
  }
  // Best-effort: the match is already recorded, and a failed attach is
  // retriable from the card.
  await attachReceiptToPostedXeroDraft({
    fileId,
    ctx,
    endpoint: attachTo.entity === "bill" || attachTo.entity === "invoice"
      ? "Invoices"
      : "BankTransactions",
    postedXeroId: attachTo.qboId,
  });
  // NOT "posted": nothing was created. The card reads this to say the receipt
  // was attached to a transaction that was already there, and Undo unlinks
  // rather than deleting a transaction Vylan never made.
  return { kind: "matched_existing", ...base, postedQboId: attachTo.qboId };
}
