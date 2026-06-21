"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { regenerateDraftAction } from "@/app/actions/quickbooks";

// "Refresh" control on a QuickBooks draft card. Re-maps the file's stored
// transaction read against the firm's CURRENT cached lists (use after adding the
// missing vendor/account in QuickBooks + refreshing the cache). Read-only on
// QuickBooks; no re-upload, no second AI call.
export function RegenerateDraftButton({ fileId }: { fileId: string }) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function onClick() {
    setFailed(false);
    startTransition(async () => {
      const res = await regenerateDraftAction(fileId);
      if (res.ok) router.refresh();
      else setFailed(true);
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
        aria-label={t("refresh_draft")}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
      >
        <RefreshCw
          className={"h-3 w-3" + (pending ? " animate-spin" : "")}
          aria-hidden="true"
        />
        {t("refresh_draft")}
      </button>
      {failed && (
        <span role="alert" className="text-[11px] text-warning">
          {t("refresh_failed")}
        </span>
      )}
    </span>
  );
}
