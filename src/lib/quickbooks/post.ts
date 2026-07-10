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
  listFirmPostedQboIds,
} from "@/lib/db/quickbooks-suggestions";
import {
  findRegisterCandidates,
  classifyRegisterMatch,
  REGISTER_MATCH_WINDOW_DAYS,
  type RegisterCandidate,
  type RegisterSearch,
} from "@/lib/quickbooks/register-match";
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
  // Smart posting part 3: the transaction was ALREADY in QuickBooks (bank feed
  // or the client's bookkeeper got there first) — the receipt was attached to
  // it and NOTHING was created. postedQboId is the existing transaction's id.
  | "matched_existing"
  // Smart posting part 3: one or more posted transactions look like this draft
  // but the match isn't beyond doubt — the accountant must choose (attach to
  // one of matchCandidates, or force a create). Nothing was written anywhere.
  | "needs_match_confirmation"
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
  // Set on 'needs_match_confirmation': the already-posted QuickBooks
  // transactions this draft may duplicate, for the accountant to choose from.
  matchCandidates?: RegisterCandidate[];
};

// The accountant's answer to a needs_match_confirmation prompt:
//   'create' — post a new transaction, skip the register match entirely;
//   'attach' — this IS the existing transaction `qboId`; attach the receipt to
//              it instead of creating. Re-validated server-side: the id must
//              still be a current amount+date-window candidate.
export type PostMatchOverride =
  | { action: "create" }
  | { action: "attach"; qboId: string };

// Post one approved EXPENSE draft as a QuickBooks Bill. Idempotent + safe:
//  - schema gate (postReady): never call QuickBooks if we can't record it;
//  - already-posted → no-op success;
//  - stable requestid (fileId-postAttempt) → a retry/race returns the original;
//  - conditional record (status='approved' AND post_attempt unchanged) → never
//    records a voided/reopened draft as posted.
// `opts.lists` / `opts.ctx` let a bulk caller fetch the lists + connection
// context ONCE and reuse them across drafts (pass undefined to fetch per call).
// `opts.match` carries the accountant's answer to a prior
// needs_match_confirmation (attach to an existing transaction / force-create).
export async function postApprovedDraft(
  fileId: string,
  posterId: string,
  opts?: {
    lists?: QuickbooksLists | null;
    ctx?: QuickbooksReadContext | null;
    match?: PostMatchOverride;
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

  // ── Smart match-or-create (part 3) ─────────────────────────────────────────
  // Before creating, look for this SAME transaction already POSTED in
  // QuickBooks (amount to the penny, date within ±5 days): the bank feed or the
  // client's bookkeeper may have recorded it first. A CLEAR match attaches the
  // receipt to the existing transaction instead of creating a duplicate; an
  // uncertain one asks the accountant. Both are skipped pre-migration-0510
  // (matchReady false — a match couldn't be recorded, so don't look for one).
  //
  // Search BOTH expense registers: a duplicate expense can exist as a paid
  // Expense (bank-feed accept) OR a Bill (hand-entered) regardless of which one
  // this draft would post.
  const searchEntities: QboTxnEntity[] =
    s.direction === "income" ? ["invoice"] : ["bill", "purchase"];

  // EXPLICIT ATTACH — the accountant already answered "this IS the existing
  // transaction". This FAILS CLOSED: if we can't re-verify the pick we must NOT
  // fall through to a create, or we'd manufacture the very duplicate they told
  // us already exists. (Contrast the automatic check below, which fails open.)
  if (opts?.match?.action === "attach") {
    // Capture the pick now, while the union is narrowed to the attach variant
    // (the narrowing is lost across the awaits below, since `opts` is a param).
    const pickedQboId = opts.match.qboId;
    // A match can't be recorded pre-0510 (the void route relies on the marker
    // to UNLINK instead of deleting a transaction Vylan never created). Rather
    // than create a known duplicate, ask the accountant to retry.
    if (!draft.matchReady) {
      return {
        kind: "post_failed",
        ...base,
        detail:
          "Couldn't confirm this match in QuickBooks. Please refresh and try again.",
      };
    }
    const excludeQboIds = await listFirmPostedQboIds(draft.firmId);
    let search: RegisterSearch | null = null;
    if (excludeQboIds != null) {
      try {
        search = await findRegisterCandidates(ctx, {
          entities: searchEntities,
          date: effDate,
          windowDays: REGISTER_MATCH_WINDOW_DAYS,
          amount: s.amount!,
          excludeQboIds,
        });
      } catch (e) {
        console.error(
          "[quickbooks] attach re-validation search failed (NOT creating):",
          e instanceof QuickbooksError ? e.code : "unknown",
          e instanceof QuickbooksError ? e.message : (e as Error).message,
        );
      }
    }
    if (search == null) {
      // Couldn't run a fresh search (null exclusion read or a thrown query). We
      // can neither confirm the pick nor safely create — report a soft failure
      // so the accountant retries; never a silent duplicate.
      return {
        kind: "post_failed",
        ...base,
        detail:
          "Couldn't confirm this match in QuickBooks. Please try again.",
      };
    }
    // Re-validate the pick against the FRESH search (the id must still match on
    // amount + date window). Gone/changed → re-ask with the current candidates
    // rather than attach blind (and, again, never fall through to a create).
    const attachTo =
      search.candidates.find((c) => c.qboId === pickedQboId) ?? null;
    if (!attachTo) {
      return {
        kind: "needs_match_confirmation",
        ...base,
        matchCandidates: search.candidates,
      };
    }
    return recordMatchAndAttach({
      attachTo,
      fileId,
      expectedAttempt: draft.postAttempt,
      posterId,
      ctx,
      base,
    });
  }

  // AUTOMATIC pre-create check (no override) — FAIL-OPEN: any failure logs and
  // falls through to the normal create; the duplicate check must never block a
  // legitimate post. Skipped when the accountant chose "post a new one"
  // (match.action === 'create', so opts.match is set) or pre-0510.
  if (!opts?.match && draft.matchReady) {
    try {
      // Exclude every transaction Vylan itself posted for this firm — read
      // FRESH per post so a draft posted seconds ago (mid-bulk) is already
      // excluded. A null read means "couldn't check", not "none": skip
      // matching rather than risk matching a Vylan-posted transaction.
      const excludeQboIds = await listFirmPostedQboIds(draft.firmId);
      if (excludeQboIds != null) {
        const search = await findRegisterCandidates(ctx, {
          entities: searchEntities,
          date: effDate,
          windowDays: REGISTER_MATCH_WINDOW_DAYS,
          amount: s.amount!,
          excludeQboIds,
        });
        const verdict = classifyRegisterMatch({
          search,
          draftEntity: entity,
          draftVendorId: eff.party?.id ?? null,
          draftVendorNames: [eff.party?.name ?? null, s.partySource ?? null],
        });
        if (verdict.kind === "confirm") {
          return {
            kind: "needs_match_confirmation",
            ...base,
            matchCandidates: search.candidates,
          };
        }
        if (verdict.kind === "clear") {
          return recordMatchAndAttach({
            attachTo: verdict.candidate,
            fileId,
            expectedAttempt: draft.postAttempt,
            posterId,
            ctx,
            base,
          });
        }
      }
    } catch (e) {
      // Fail-open: the register read is best-effort. Log (with the intuit_tid
      // already at the front of a QuickbooksError message) and create as usual.
      console.error(
        "[quickbooks] register match check failed (posting anyway):",
        e instanceof QuickbooksError ? e.code : "unknown",
        e instanceof QuickbooksError ? e.message : (e as Error).message,
      );
    }
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

// Record a MATCHED-to-existing draft (the receipt's transaction was already in
// QuickBooks) and attach the receipt to it — shared by the automatic clear-match
// path and the accountant's explicit attach. Records with the SAME conditional
// guard as a create (still approved + attempt unchanged) so a concurrent
// void/reopen can't be overwritten, then attaches the receipt to that existing
// transaction. NOTHING was created in QuickBooks, so a failed record here is
// fully benign — the accountant just retries. Never throws.
async function recordMatchAndAttach(input: {
  attachTo: RegisterCandidate;
  fileId: string;
  expectedAttempt: number;
  posterId: string;
  ctx: QuickbooksReadContext;
  base: { engagementId: string | null; firmId: string | null };
}): Promise<PostOutcome> {
  const { attachTo, fileId, base } = input;
  const recorded = await recordDraftPosted({
    uploadedFileId: fileId,
    expectedAttempt: input.expectedAttempt,
    postedQboId: attachTo.qboId,
    postedSyncToken: attachTo.syncToken ?? "0",
    posterId: input.posterId,
    matchedQboType: attachTo.entity,
  });
  if (recorded === "conflict") return { kind: "conflict", ...base };
  if (recorded !== "ok") {
    return {
      kind: "record_failed",
      ...base,
      postedQboId: attachTo.qboId,
      detail:
        "Found this transaction in QuickBooks but couldn't save the match. Refresh and retry.",
    };
  }
  await attachReceiptToPostedDraft({
    ctx: input.ctx,
    entity: attachTo.entity,
    fileId,
    postedQboId: attachTo.qboId,
  });
  return { kind: "matched_existing", ...base, postedQboId: attachTo.qboId };
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
