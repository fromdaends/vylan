// The ONE rule that decides whether the unauthenticated client portal may serve
// a "final document" (an accountant deliverable) to the client. It is the single
// server-side choke point for the Final documents section — the client reaches
// deliverable bytes ONLY through /api/portal/deliverables/[id], which calls this;
// nothing embeds a direct signed URL, so this rule cannot be bypassed.
//
// Two independent gates:
//   1. Access — same token/engagement/ownership check as any portal file
//      (isPortalFileAccessAllowed): the token resolves to a non-cancelled,
//      non-expired engagement, and the deliverable belongs to THAT engagement.
//   2. Lock — an optional per-invoice "lock final documents until paid". When an
//      invoice locks deliverables and is unpaid (and not manually overridden), the
//      client cannot download the finished work. The lock gates THIS section only;
//      it NEVER affects uploads, signing, or signed-document access, which don't
//      route through here.
//
// Kept PURE and exhaustively unit-tested so the rule is one provable source of
// truth, not logic hidden in a route. Phase 3 passes lock = null (downloads always
// allowed); Phase 4 wires the engagement's invoice in.

import {
  isPortalFileAccessAllowed,
  type PortalEngagementRow,
} from "@/lib/portal/file-access";

export type InvoiceStatus = "requested" | "paid" | "failed" | "canceled";

// The engagement's current invoice as it bears on the lock. null = no lock to
// evaluate (no invoice, or the caller hasn't loaded it — Phase 3).
export type DeliverableLockState = {
  // invoice.locks_deliverables — the accountant's "lock until paid" choice.
  locksDeliverables: boolean;
  // invoice.status — 'paid' and 'canceled' (waived) both unlock.
  invoiceStatus: InvoiceStatus | null;
  // invoice.override_unlocked — accountant's manual "unlock without payment".
  overrideUnlocked: boolean;
} | null;

// Final documents are locked only when there is an invoice that locks them, it is
// still owed (requested/failed), and the accountant hasn't overridden. A paid or
// canceled/waived invoice, or no invoice at all, means unlocked.
export function isDeliverablesLocked(lock: DeliverableLockState): boolean {
  if (!lock) return false;
  if (!lock.locksDeliverables) return false;
  if (lock.overrideUnlocked) return false;
  return lock.invoiceStatus === "requested" || lock.invoiceStatus === "failed";
}

// The EFFECTIVE lock decision used by both the download route and the portal, so
// they can never disagree. When an invoice row exists, its state decides (above).
// When NO invoice row exists yet — the deferred modes (on_completion / delayed)
// create the payment_requests row late, and a create-now invoice can fail to
// record — we fall back to the engagement's captured lock preference: nothing is
// paid, so the finished work stays gated. This also makes the enforcement gate
// fail CLOSED if the invoice read errors (null invoice → engagement preference).
export function computeDeliverablesLocked(input: {
  invoice: {
    locks_deliverables?: boolean;
    status: InvoiceStatus;
    override_unlocked?: boolean;
  } | null;
  engagementLocksDeliverables: boolean;
}): boolean {
  if (input.invoice) {
    return isDeliverablesLocked({
      locksDeliverables: input.invoice.locks_deliverables === true,
      invoiceStatus: input.invoice.status,
      overrideUnlocked: input.invoice.override_unlocked === true,
    });
  }
  return input.engagementLocksDeliverables === true;
}

export function isDeliverableDownloadAllowed(input: {
  tokenShapeValid: boolean;
  engagement: PortalEngagementRow;
  // The requested final-document row (carries engagement_id), or null if no row
  // matched that id.
  deliverable: { engagement_id: string } | null;
  // The effective lock decision (from computeDeliverablesLocked). Defaults to
  // false (Phase 3 called it with no lock).
  locked?: boolean;
  now?: Date;
}): boolean {
  // Reuse the exact portal access check (token/engagement/ownership) — a
  // deliverable row is shaped like a file row (has engagement_id).
  if (
    !isPortalFileAccessAllowed({
      tokenShapeValid: input.tokenShapeValid,
      engagement: input.engagement,
      file: input.deliverable,
      now: input.now,
    })
  ) {
    return false;
  }
  // A locked deliverable is inaccessible even to a valid token.
  if (input.locked === true) return false;
  return true;
}
