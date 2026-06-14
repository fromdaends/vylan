"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { PlanId } from "@/lib/plans";

export function CheckoutButton({
  planId,
  disabled,
  disabledLabel,
  label,
}: {
  planId: PlanId;
  disabled?: boolean;
  disabledLabel?: string;
  label: string;
}) {
  const t = useTranslations("Billing");
  const [pending, startTransition] = useTransition();
  // A localized, user-facing message (never a raw error code like
  // "checkout_failed", which previously rendered straight to the user).
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: planId }),
        });
        const j = (await res.json().catch(() => null)) as
          | { url?: string; error?: string }
          | null;
        if (j?.url) {
          window.location.href = j.url;
        } else {
          setError(t("checkout_failed"));
        }
      } catch {
        setError(t("checkout_failed"));
      }
    });
  }

  if (disabled) {
    return (
      <Button disabled className="w-full" title={disabledLabel}>
        {disabledLabel ?? label}
      </Button>
    );
  }

  return (
    <div className="space-y-1">
      <Button onClick={go} disabled={pending} className="w-full">
        {pending ? "…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
