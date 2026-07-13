import { getTranslations } from "next-intl/server";
import { Lock, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { unlockDeliverablesAction } from "@/app/actions/invoices";
import { WaiveInvoiceButton } from "@/components/engagements/waive-invoice-button";

// Accountant controls for a live (unpaid) invoice's deliverables lock: a lock
// status badge plus the always-available manual escape hatches — "Unlock without
// payment" (comped / paid by cheque) and "Waive invoice" (cancel it). Only shown
// on a live invoice; a paid/cancelled invoice needs neither.
export async function InvoiceLockControls({
  engagementId,
  invoice,
  engagementLocksDeliverables,
}: {
  engagementId: string;
  invoice: {
    id: string;
    status: string;
    locks_deliverables?: boolean;
    override_unlocked?: boolean;
  } | null;
  // The engagement's lock preference — drives the fallback-locked state when no
  // invoice row exists yet (deferred invoice), so the accountant always has an
  // unlock even before an invoice exists.
  engagementLocksDeliverables: boolean;
}) {
  const t = await getTranslations("Engagements");
  const live =
    !!invoice &&
    (invoice.status === "requested" || invoice.status === "failed");

  // No live invoice, but the finished work is fallback-locked by the engagement
  // preference: still offer the manual unlock (override is always available).
  if (!live) {
    if (!engagementLocksDeliverables) return null;
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="secondary" className="gap-1 font-normal">
          <Lock className="size-3" aria-hidden />
          {t("lock_badge_locked")}
        </Badge>
        <form action={unlockDeliverablesAction}>
          <input type="hidden" name="engagement_id" value={engagementId} />
          <Button type="submit" variant="ghost" size="sm">
            {t("lock_unlock")}
          </Button>
        </form>
      </div>
    );
  }

  const locks = invoice!.locks_deliverables === true;
  const overridden = invoice!.override_unlocked === true;
  const isLocked = locks && !overridden;

  return (
    <div className="flex items-center gap-1.5">
      {locks && (
        <Badge variant="secondary" className="gap-1 font-normal">
          {isLocked ? (
            <Lock className="size-3" aria-hidden />
          ) : (
            <Unlock className="size-3" aria-hidden />
          )}
          {isLocked ? t("lock_badge_locked") : t("lock_badge_unlocked")}
        </Badge>
      )}
      {isLocked && (
        <form action={unlockDeliverablesAction}>
          <input type="hidden" name="engagement_id" value={engagementId} />
          <Button type="submit" variant="ghost" size="sm">
            {t("lock_unlock")}
          </Button>
        </form>
      )}
      <WaiveInvoiceButton engagementId={engagementId} />
    </div>
  );
}
