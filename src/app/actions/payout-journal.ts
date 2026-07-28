"use server";

// Server actions for the payout journal entry (migration 1010).
//
// Any firm member may map accounts and approve, matching the bookkeeping
// draft flow — the connection itself is owner-gated, but routine bookkeeping
// on an engagement is ordinary work. Every action re-proves the engagement
// belongs to the caller's firm before touching anything.

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getEngagement } from "@/lib/db/engagements";
import {
  savePayoutJournalMapping,
  setPayoutJournalStatus,
} from "@/lib/db/payout-journal";
import { postPayoutJournal } from "@/lib/quickbooks/post-payout-journal";
import type {
  AccountRef,
  PayoutRole,
} from "@/lib/quickbooks/payout-journal";

const ROLES: PayoutRole[] = [
  "bank",
  "sales",
  "fees",
  "fee_tax",
  "refunds",
  "adjustments",
];

export type PayoutJournalActionState = {
  ok: boolean;
  error?:
    | "no_session"
    | "not_found"
    | "frozen"
    | "unavailable"
    | "invalid_role"
    | "save_failed";
};

/** Set (or clear, with null) the account for ONE role on a payout journal. */
export async function setPayoutJournalAccountAction(input: {
  engagementId: string;
  uploadedFileId: string;
  role: string;
  account: AccountRef | null;
}): Promise<PayoutJournalActionState> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!ROLES.includes(input.role as PayoutRole)) {
    return { ok: false, error: "invalid_role" };
  }
  // Scope proof: the engagement must belong to this member's firm.
  const engagement = await getEngagement(input.engagementId).catch(() => null);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  const account =
    input.account &&
    typeof input.account.id === "string" &&
    typeof input.account.name === "string"
      ? { id: input.account.id, name: input.account.name }
      : null;

  const result = await savePayoutJournalMapping({
    firmId: firm.id,
    uploadedFileId: input.uploadedFileId,
    mapping: { [input.role as PayoutRole]: account },
  });
  if (result !== "ok") {
    return {
      ok: false,
      error:
        result === "not_found"
          ? "not_found"
          : result === "frozen"
            ? "frozen"
            : result === "unavailable"
              ? "unavailable"
              : "save_failed",
    };
  }
  revalidatePath(`/engagements/${input.engagementId}`);
  return { ok: true };
}

/** Approve (or send back to draft) a payout journal entry. */
export async function setPayoutJournalStatusAction(input: {
  engagementId: string;
  uploadedFileId: string;
  status: "draft" | "approved";
}): Promise<PayoutJournalActionState> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  const engagement = await getEngagement(input.engagementId).catch(() => null);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  const result = await setPayoutJournalStatus({
    firmId: firm.id,
    uploadedFileId: input.uploadedFileId,
    status: input.status,
    userId: user.id,
  });
  if (result !== "ok") {
    return {
      ok: false,
      error:
        result === "not_found"
          ? "not_found"
          : result === "frozen"
            ? "frozen"
            : result === "unavailable"
              ? "unavailable"
              : "save_failed",
    };
  }
  revalidatePath(`/engagements/${input.engagementId}`);
  return { ok: true };
}

export type PostPayoutJournalState = {
  ok: boolean;
  /** Machine key the card maps to localized copy. */
  error?:
    | "no_session"
    | "not_found"
    | "not_approved"
    | "not_connected"
    | "not_buildable"
    | "missing_account_codes"
    | "post_failed";
  accountNames?: string[];
  message?: string;
};

/** Post an approved payout journal entry into the client's ledger. */
export async function postPayoutJournalAction(input: {
  engagementId: string;
  uploadedFileId: string;
  processor: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  payoutDate: string | null;
}): Promise<PostPayoutJournalState> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  const engagement = await getEngagement(input.engagementId).catch(() => null);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  const outcome = await postPayoutJournal({
    uploadedFileId: input.uploadedFileId,
    firmId: firm.id,
    userId: user.id,
    processor: input.processor,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    payoutDate: input.payoutDate,
  });

  revalidatePath(`/engagements/${input.engagementId}`);

  switch (outcome.kind) {
    case "posted":
    // An already-posted entry is a success from the user's point of view:
    // the journal they wanted in the ledger is in the ledger.
    case "already_posted":
      return { ok: true };
    case "missing_account_codes":
      return {
        ok: false,
        error: "missing_account_codes",
        accountNames: outcome.accountNames,
      };
    case "post_failed":
      return { ok: false, error: "post_failed", message: outcome.message };
    case "not_buildable":
      return { ok: false, error: "not_buildable" };
    default:
      return { ok: false, error: outcome.kind };
  }
}
