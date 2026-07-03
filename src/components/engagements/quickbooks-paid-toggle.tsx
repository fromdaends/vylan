"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

// The Bill-vs-Purchase choice on an EXPENSE draft (Stage: paid expenses). An
// unpaid bill posts a QuickBooks "Bill" (accounts payable); an already-paid
// receipt posts a "Purchase"/Expense against a bank/credit-card account. Saving
// sets `paid` on the accountant's resolved mapping via the stable resolve endpoint
// (deploy-skew-proof, optimistic). Locked (read-only) once the draft is decided.
export function QuickbooksPaidToggle({
  fileId,
  mode,
  disabled = false,
}: {
  fileId: string;
  mode: "bill" | "purchase";
  disabled?: boolean;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [value, setValue] = useState<"bill" | "purchase">(mode);
  const [pending, setPending] = useState(false);

  async function save(next: "bill" | "purchase") {
    if (next === value || pending) return;
    const prev = value;
    setValue(next); // optimistic
    setPending(true);
    try {
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paid: next === "purchase" }),
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

  const options: { key: "bill" | "purchase"; label: string }[] = [
    { key: "bill", label: t("record_as_bill") },
    { key: "purchase", label: t("record_as_purchase") },
  ];

  if (disabled) {
    return (
      <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 opacity-80">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("record_as")}
        </div>
        <div className="mt-0.5 text-sm font-medium text-foreground">
          {value === "purchase" ? t("record_as_purchase") : t("record_as_bill")}
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
            key={o.key}
            type="button"
            disabled={pending}
            aria-pressed={value === o.key}
            onClick={() => save(o.key)}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60",
              value === o.key
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
