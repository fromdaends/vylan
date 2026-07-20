"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { QuickbooksLogo } from "@/components/quickbooks/quickbooks-logo";
import { XeroLogo } from "@/components/integrations/xero-logo";

// "Import from your bookkeeping software" — starts the OAuth import flow for
// the chosen provider. The accountant signs into their OWN company (where their
// clients exist as customers); the callback stages the list and returns here.
export function BookkeepingImportButtons({
  qboEnabled,
  xeroEnabled,
}: {
  qboEnabled: boolean;
  xeroEnabled: boolean;
}) {
  const t = useTranslations("Clients");
  const [loading, setLoading] = useState<"quickbooks" | "xero" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(provider: "quickbooks" | "xero") {
    setLoading(provider);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${provider}/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "import" }),
      });
      const data = (await res.json().catch(() => null)) as {
        url?: string;
      } | null;
      if (res.ok && data?.url) {
        window.location.assign(data.url);
        return;
      }
      setError(t("bk_import_error"));
    } catch {
      setError(t("bk_import_error"));
    }
    setLoading(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => start("quickbooks")}
          disabled={!qboEnabled || loading !== null}
          aria-busy={loading === "quickbooks"}
          className="gap-2"
        >
          <QuickbooksLogo className="h-4 w-4" />
          {loading === "quickbooks" ? "…" : t("bk_import_qbo_cta")}
        </Button>
        <Button
          variant="outline"
          onClick={() => start("xero")}
          disabled={!xeroEnabled || loading !== null}
          aria-busy={loading === "xero"}
          className="gap-2"
        >
          <XeroLogo className="h-4 w-4" />
          {loading === "xero" ? "…" : t("bk_import_xero_cta")}
        </Button>
      </div>
      {(!qboEnabled || !xeroEnabled) && (
        <p className="text-xs text-muted-foreground">
          {t("bk_import_unavailable")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
