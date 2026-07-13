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
}: {
  engagementId: string;
  invoice: {
    id: string;
    status: string;
    locks_deliverables?: boolean;
    override_unlocked?: boolean;
  } | null;
}) {
  const t = await getTranslations("Engagements");
  if (!invoice) return null;
  const live = invoice.status === "requested" || invoice.status === "failed";
  if (!live) return null;

  const locks = invoice.locks_deliverables === true;
  const overridden = invoice.override_unlocked === true;
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
