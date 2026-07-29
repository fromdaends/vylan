// Post an approved payout journal entry to the client's ledger.
//
// Orchestration only: the balanced entry comes from payout-journal.ts and the
// wire shapes from journal-payload.ts, both pure and tested. What lives here
// is the ordering that keeps a client's books honest:
//
//   1. Re-read the draft from the database (never trust the caller's copy).
//   2. Refuse unless it is APPROVED and not already posted — the
//      already-posted check is what stops a double-click from booking the
//      same payout twice.
//   3. Rebuild the journal from the SNAPSHOTTED figures + saved mapping, so
//      what posts is exactly what the accountant approved.
//   4. Post, then record the ledger's own id. A failure records the reason
//      and leaves the draft approved so it can be retried.

import {
  getPayoutJournalForFile,
  recordPayoutJournalPostError,
  recordPayoutJournalPosted,
} from "@/lib/db/payout-journal";
import { readXeroAccountMeta } from "@/lib/db/xero-cache";
import { blockedJournalAccounts } from "./journal-accounts";
import { getXeroReadContext } from "@/lib/xero/connection";
import { xeroCreateManualJournal } from "@/lib/xero/write";
import { getQuickbooksReadContext } from "@/lib/quickbooks/connection";
import { quickbooksCreateJournalEntry } from "@/lib/quickbooks/client";
import { buildPayoutJournal, journalMemo } from "./payout-journal";
import {
  buildQboJournalPayload,
  buildXeroJournalPayload,
  journalDate,
} from "./journal-payload";

export type PostPayoutJournalOutcome =
  | { kind: "posted"; ref: string; link: string | null }
  | { kind: "already_posted"; ref: string | null }
  | { kind: "not_found" }
  | { kind: "not_approved" }
  | { kind: "not_connected" }
  // Connected, but the grant predates the journal permission (Xero bakes
  // scopes into the token at authorization time). Only a reconnect fixes it.
  | { kind: "needs_reconnect" }
  // The entry couldn't be built — figures don't reconcile, or accounts are
  // still unmapped. Both are the accountant's to fix, not retryable as-is.
  | { kind: "not_buildable"; reason: string }
  // Xero only: an account has no code cached, so its line can't be addressed.
  | { kind: "missing_account_codes"; accountNames: string[] }
  // Xero only: a mapped account is a bank/credit-card account, which Xero
  // refuses in a manual journal. The accountant remaps to a clearing account.
  | { kind: "blocked_accounts"; accountNames: string[] }
  // Xero only: the account cache is EMPTY, which after a (re)connect means the
  // background sync hasn't finished. Transient — retrying shortly works.
  | { kind: "accounts_syncing" }
  | { kind: "post_failed"; message: string };

export async function postPayoutJournal(input: {
  uploadedFileId: string;
  firmId: string;
  userId: string;
  /** Figures needed for the memo/date, read off the stored extraction. */
  processor: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  payoutDate: string | null;
}): Promise<PostPayoutJournalOutcome> {
  const draft = await getPayoutJournalForFile(input.uploadedFileId);
  if (!draft || draft.firmId !== input.firmId) return { kind: "not_found" };
  // Idempotency: a posted entry exists in the ledger and is never re-sent.
  if (draft.status === "posted") {
    return { kind: "already_posted", ref: draft.postedRef };
  }
  if (draft.status !== "approved") return { kind: "not_approved" };

  // Rebuild from the snapshot — what posts is what was approved.
  const built = buildPayoutJournal(draft.figures, draft.mapping);
  if (!built.ok) return { kind: "not_buildable", reason: built.reason };

  const memo = journalMemo({
    processor: input.processor,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });
  const txnDate = journalDate({
    payoutDate: input.payoutDate,
    periodEnd: input.periodEnd,
  });

  try {
    if (draft.provider === "xero") {
      const ctx = await getXeroReadContext(draft.firmId, draft.clientId);
      if (!ctx) return { kind: "not_connected" };
      // Manual journals address accounts by CODE, not id.
      const { codeById: codeByAccountId, typeById } = await readXeroAccountMeta(
        draft.clientId,
      );
      // An EMPTY map is a sync race, not a data problem: reconnecting Xero
      // clears and refills this cache in the background, and a post attempted
      // in that window would otherwise report every account as "no code",
      // which reads as the accountant's fault and is permanent-sounding.
      if (codeByAccountId.size === 0) {
        await recordPayoutJournalPostError({
          firmId: draft.firmId,
          uploadedFileId: input.uploadedFileId,
          error:
            "The chart of accounts was still syncing from Xero. Try posting again in a moment.",
        });
        return { kind: "accounts_syncing" };
      }
      // Xero will not let a manual journal move a bank balance — it rejects
      // the whole entry with a validation error. Catch it here, against the
      // accounts the entry ACTUALLY uses (folded roles included), so the
      // accountant gets the fix rather than Xero's rejection.
      const blocked = blockedJournalAccounts(
        "xero",
        built.journal.lines.map((l) => l.account),
        typeById,
      );
      if (blocked.length > 0) {
        await recordPayoutJournalPostError({
          firmId: draft.firmId,
          uploadedFileId: input.uploadedFileId,
          error: `Xero doesn't allow a journal entry to touch a bank account (${blocked.join(", ")}). Reopen the entry and choose a clearing account instead.`,
        });
        return { kind: "blocked_accounts", accountNames: blocked };
      }
      const payload = buildXeroJournalPayload({
        journal: built.journal,
        memo,
        txnDate,
        codeByAccountId,
      });
      if (!payload.ok) {
        // Record it too, so the card's "last attempt" line reflects THIS
        // failure rather than a stale earlier one.
        await recordPayoutJournalPostError({
          firmId: draft.firmId,
          uploadedFileId: input.uploadedFileId,
          error: `No Xero account code on: ${payload.accountNames.join(", ")}`,
        });
        return {
          kind: "missing_account_codes",
          accountNames: payload.accountNames,
        };
      }
      const created = await xeroCreateManualJournal(
        ctx,
        payload.payload as unknown as Record<string, unknown>,
        // Idempotency key: an in-flight retry returns the original create
        // rather than a second journal.
        `payout-journal-${input.uploadedFileId}`,
      );
      await recordPayoutJournalPosted({
        firmId: draft.firmId,
        uploadedFileId: input.uploadedFileId,
        postedRef: created.id,
        postedLink: null,
        userId: input.userId,
      });
      return { kind: "posted", ref: created.id, link: null };
    }

    const ctx = await getQuickbooksReadContext(draft.firmId, draft.clientId);
    if (!ctx) return { kind: "not_connected" };
    const payload = buildQboJournalPayload({
      journal: built.journal,
      memo,
      txnDate,
    });
    const created = await quickbooksCreateJournalEntry(
      ctx,
      payload as unknown as Record<string, unknown>,
    );
    await recordPayoutJournalPosted({
      firmId: draft.firmId,
      uploadedFileId: input.uploadedFileId,
      postedRef: created.id,
      postedLink: null,
      userId: input.userId,
    });
    return { kind: "posted", ref: created.id, link: null };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    // A 401 on the journal endpoint from an otherwise-live connection means the
    // token was granted before accounting.manualjournals was requested. Say
    // that plainly instead of surfacing Xero's raw JSON.
    const status = (e as { status?: number }).status;
    if (status === 401 || /401|Unauthorized/i.test(message)) {
      await recordPayoutJournalPostError({
        firmId: draft.firmId,
        uploadedFileId: input.uploadedFileId,
        error:
          "The bookkeeping connection was authorized before journal entries were supported. Reconnect it to grant that permission.",
      });
      return { kind: "needs_reconnect" };
    }
    // Record WHY so the accountant isn't left guessing, and leave the draft
    // approved so the same entry can be retried once the cause is fixed.
    await recordPayoutJournalPostError({
      firmId: draft.firmId,
      uploadedFileId: input.uploadedFileId,
      error: message,
    });
    console.error("[payout-journal] post failed:", message);
    return { kind: "post_failed", message };
  }
}
