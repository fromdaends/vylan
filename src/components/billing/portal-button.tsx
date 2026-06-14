"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PortalButton({ label }: { label: string }) {
  const t = useTranslations("Billing");
  const [pending, startTransition] = useTransition();
  // Localized, user-facing message (never the raw "portal_failed" code).
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/portal", { method: "POST" });
        const j = (await res.json().catch(() => null)) as
          | { url?: string; error?: string }
          | null;
        if (j?.url) {
          window.location.href = j.url;
        } else {
          setError(t("portal_failed"));
        }
      } catch {
        setError(t("portal_failed"));
      }
    });
  }

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" onClick={go} disabled={pending}>
        {pending ? "…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
