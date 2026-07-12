// Invoice automation dispatch (migration 0590): decide, at engagement
// completion, whether to send the invoice now, schedule it for later, or do
// nothing — and cancel a scheduled invoice when the engagement is reopened /
// archived / deleted. The actual send lives in ./send (sendEngagementInvoice),
// reused by the cron worker for the delayed case.

import { cancelPendingJobs, enqueueJob } from "@/lib/db/jobs";
import { invoiceRunAfterMs } from "./resolve";
import { sendEngagementInvoice } from "./send";

type CompletedEngagement = {
  id: string;
  // Undefined pre-migration 0590 → treated as 'off' (no automation).
  invoice_auto_mode?: "off" | "on_completion" | "delayed";
  invoice_delay_days?: number | null;
  completed_at?: string | null;
};

// Run right after an engagement is marked complete. Best-effort: the caller
// must not let this throw fail the completion itself.
export async function dispatchInvoiceOnCompletion(
  engagement: CompletedEngagement,
): Promise<void> {
  const mode = engagement.invoice_auto_mode ?? "off";

  if (mode === "on_completion") {
    await sendEngagementInvoice(engagement.id);
    return;
  }

  if (mode === "delayed") {
    const days = Number(engagement.invoice_delay_days ?? 0);
    // Anchor the delay to when it was completed (which is ~now); fall back to
    // now if the timestamp is somehow unreadable.
    const base = engagement.completed_at
      ? new Date(engagement.completed_at)
      : null;
    const startMs =
      base && !Number.isNaN(base.getTime()) ? base.getTime() : Date.now();
    const runAfter = new Date(invoiceRunAfterMs(startMs, days));
    // Re-complete safety: drop any earlier scheduled invoice for this
    // engagement first, so a reopen→re-complete never queues two.
    await cancelScheduledInvoice(engagement.id);
    await enqueueJob({
      kind: "send_payment_request",
      payload: { engagementId: engagement.id },
      runAfter,
    });
  }
}

// Drop any pending delayed invoice for an engagement (reopen / archive /
// delete), so it never fires against work that's no longer complete.
export async function cancelScheduledInvoice(
  engagementId: string,
): Promise<void> {
  await cancelPendingJobs(
    "send_payment_request",
    (p) => p.engagementId === engagementId,
  );
}
