"use client";

import { useTranslations } from "next-intl";
import { StatusCapsule, type StatusTone } from "@/components/ui/status-capsule";
import { cn } from "@/lib/cn";
import type { InvoiceDisplayStatus } from "@/lib/invoices/outstanding";

// Invoice status, in the UI kit's one shape: a NEUTRAL capsule with a small
// coloured dot. Not a filled pill — a column of solid green/red badges is the
// noise that makes the one invoice actually needing attention invisible.
//
// The tones follow the kit's meaning, not the mood of the word:
//   paid        success
//   partly_paid accent      — money arriving is progress, not a problem
//   unpaid      muted       — the resting state of a fresh invoice
//   overdue     WARNING     — amber, not red. Red is for damage; an invoice
//                             being late is a chase, not a loss. (Kit rule 4.)
//   failed      destructive — a payment that actually broke
const TONE: Record<Exclude<InvoiceDisplayStatus, "void">, StatusTone> = {
  unpaid: "muted",
  partly_paid: "accent",
  overdue: "warning",
  failed: "destructive",
  paid: "success",
};

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: InvoiceDisplayStatus;
  className?: string;
}) {
  const t = useTranslations("FirmBilling");
  const label = t(`status_${status}`);

  // VOID is not a state worth marking — it is an invoice that no longer
  // counts. It reads as struck-through muted text, so it recedes instead of
  // competing with the live rows around it.
  if (status === "void") {
    return (
      <span
        className={cn(
          "text-[12.5px] text-muted-foreground/70 line-through",
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <StatusCapsule tone={TONE[status]} className={className}>
      {label}
    </StatusCapsule>
  );
}
