"use client";

import { Check, Wallet, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
// Type-only import (erased at build) — safe in this client component even though
// payment-requests.ts is server code.
import type { PaymentRequestStatus } from "@/lib/db/payment-requests";

// The one payment-status chip used everywhere a per-engagement payment shows:
// dashboard worklist, engagements list, client page, and the payments lists.
// Paid reads clearly positive (green + check); unpaid is quiet; failed is loud.
// Renders nothing for a canceled request.
export function PaymentBadge({
  status,
  className,
}: {
  status: PaymentRequestStatus;
  className?: string;
}) {
  const t = useTranslations("Engagements");
  if (status === "canceled") return null;
  if (status === "paid") {
    return (
      <Badge
        className={cn(
          "gap-1 border-transparent bg-success/15 font-normal text-success hover:bg-success/15",
          className,
        )}
      >
        <Check className="h-3 w-3" />
        {t("pay_badge_paid")}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className={cn("gap-1 font-normal", className)}>
        <AlertCircle className="h-3 w-3" />
        {t("pay_badge_failed")}
      </Badge>
    );
  }
  // requested = not paid yet
  return (
    <Badge variant="secondary" className={cn("gap-1 font-normal", className)}>
      <Wallet className="h-3 w-3" />
      {t("pay_badge_unpaid")}
    </Badge>
  );
}
