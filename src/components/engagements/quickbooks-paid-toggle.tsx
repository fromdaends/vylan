"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

// The "was this already paid?" choice on a draft, used on BOTH directions:
//   * EXPENSE — unpaid posts a QuickBooks "Bill" (accounts payable), a paid
//     receipt a "Purchase"/Expense against a bank/credit-card account.
//   * INCOME — unpaid posts an "Invoice" (the customer owes), a paid sale a
//     "SalesReceipt" (income already received).
// Both persist the SAME `paid` boolean on the accountant's resolved mapping via
// the stable resolve endpoint (deploy-skew-proof, optimistic); the caller passes
// the two labels for the direction. Locked (read-only) once the draft is decided.
export function QuickbooksPaidToggle({
  fileId,
  paid,
  unpaidLabel,
  paidLabel,
  disabled = false,
}: {
  fileId: string;
  paid: boolean;
  unpaidLabel: string;
  paidLabel: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [value, setValue] = useState<boolean>(paid);
  const [pending, setPending] = useState(false);

  async function save(next: boolean) {
    if (next === value || pending) return;
    const prev = value;
    setValue(next); // optimistic
    setPending(true);
    try {
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paid: next }),
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (res?.ok) router.refresh();
      else setValue(prev); // revert
    } catch {
      setValue(prev);
    } finally {
      setPending(false);
    }
  }

  const options: { paid: boolean; label: string }[] = [
    { paid: false, label: unpaidLabel },
    { paid: true, label: paidLabel },
  ];

  if (disabled) {
    return (
      <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 opacity-80">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("record_as")}
        </div>
        <div className="mt-0.5 text-sm font-medium text-foreground">
          {value ? paidLabel : unpaidLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("record_as")}
      </div>
      <div
        role="group"
        aria-label={t("record_as")}
        className="mt-1 inline-flex rounded-md border border-border/60 p-0.5"
      >
        {options.map((o) => (
          <button
            key={String(o.paid)}
            type="button"
            disabled={pending}
            aria-pressed={value === o.paid}
            onClick={() => save(o.paid)}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60",
              value === o.paid
                ? "bg-accent/15 text-accent"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
