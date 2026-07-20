"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

// How long the header's "Payment canceled · $X" chip lingers after the invoice
// is waived/canceled before it hides itself. The cancellation stays permanently
// in the Activity feed + audit log; this chip is only a brief header
// confirmation so a waived invoice doesn't sit in the header forever. ~3 minutes
// ("a couple of minutes"); one-line change here if the founder wants it
// shorter/longer.
export const PAYMENT_CANCELED_CHIP_WINDOW_MS = 3 * 60_000;

// The transient header chip shown right after a payment/invoice is canceled.
// The server only mounts it while still inside the window (so a reload minutes
// later renders nothing); this component then hides itself precisely at the
// window boundary — with a short fade — so an open page doesn't have to wait for
// the 5s auto-refresh to drop it.
export function PaymentCanceledChip({
  canceledAt,
  label,
  amountLabel,
  windowMs = PAYMENT_CANCELED_CHIP_WINDOW_MS,
}: {
  // ISO timestamp of the waive (from the invoice_waived audit row).
  canceledAt: string;
  // Localized "Payment canceled" label.
  label: string;
  // Preformatted amount, e.g. "$1,000.00".
  amountLabel: string;
  windowMs?: number;
}) {
  const [state, setState] = useState<"shown" | "fading" | "hidden">("shown");

  useEffect(() => {
    const remaining = Math.max(
      0,
      windowMs - (Date.now() - new Date(canceledAt).getTime()),
    );
    const fadeTimer = window.setTimeout(() => setState("fading"), remaining);
    // Unmount a beat after the fade begins so the opacity transition can run.
    const hideTimer = window.setTimeout(
      () => setState("hidden"),
      remaining + 400,
    );
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [canceledAt, windowMs]);

  if (state === "hidden") return null;

  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 transition-opacity duration-300 motion-reduce:transition-none",
        state === "fading" && "opacity-0",
      )}
    >
      {label} · {amountLabel}
    </Badge>
  );
}
