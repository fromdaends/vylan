"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { InvoiceDisplayStatus } from "@/lib/invoices/outstanding";

// One badge, six states. Overdue and failed carry the warning treatment
// because both mean "this needs you"; partly paid is deliberately neutral —
// money arriving is not a problem, it is just not the whole story yet.
const TONE: Record<InvoiceDisplayStatus, string> = {
  unpaid: "border-border/70 bg-secondary text-muted-foreground",
  partly_paid: "border-border/70 bg-secondary text-foreground",
  overdue: "border-destructive/30 bg-destructive/10 text-destructive",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  paid: "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  void: "border-border/50 bg-transparent text-muted-foreground/70 line-through",
};

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: InvoiceDisplayStatus;
  className?: string;
}) {
  const t = useTranslations("FirmBilling");
  return (
    <Badge
      variant="outline"
      className={cn("font-normal", TONE[status], className)}
    >
      {t(`status_${status}`)}
    </Badge>
  );
}
