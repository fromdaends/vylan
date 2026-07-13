"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { waiveInvoiceAction } from "@/app/actions/invoices";

// Waiving cancels a real (unpaid) invoice with no undo — the client can no longer
// pay it and the accountant would have to create a new one. So the submit is
// gated behind a confirmation to prevent a misclick next to the pill.
export function WaiveInvoiceButton({
  engagementId,
}: {
  engagementId: string;
}) {
  const t = useTranslations("Engagements");
  return (
    <form
      action={waiveInvoiceAction}
      onSubmit={(e) => {
        if (!window.confirm(t("lock_waive_confirm"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="engagement_id" value={engagementId} />
      <Button type="submit" variant="ghost" size="sm">
        {t("lock_waive")}
      </Button>
    </form>
  );
}
