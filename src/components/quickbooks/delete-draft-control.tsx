"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2, Loader2 } from "lucide-react";
import type { DraftStatus } from "@/lib/quickbooks/draft-status";

// Delete a QuickBooks draft entirely from the firm-wide queue (the Integrations
// tab). Posts to the STABLE delete endpoint and refreshes on success. Confirms
// first — and, for a draft Vylan actually posted, warns that the QuickBooks
// transaction will be deleted too (the server voids it before removing the row).
export function DeleteDraftControl({
  fileId,
  status,
  isMatched,
}: {
  fileId: string;
  status: DraftStatus;
  // A posted draft matched to a pre-existing QuickBooks transaction (Vylan didn't
  // create it) is only unlinked — nothing is deleted in QuickBooks.
  isMatched: boolean;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const removesQboTxn = status === "posted" && !isMatched;

  function del() {
    setFailed(false);
    const message = removesQboTxn
      ? t("qbo_delete_confirm_posted")
      : t("qbo_delete_confirm");
    if (!window.confirm(message)) return;
    startTransition(async () => {
      try {
        const r = await fetch(`/api/quickbooks/suggestions/${fileId}/delete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
        const res = (await r.json().catch(() => null)) as {
          ok?: boolean;
        } | null;
        if (r.ok && res?.ok) router.refresh();
        else setFailed(true);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {failed && (
        <span role="alert" className="text-[11px] text-warning">
          {t("status_failed")}
        </span>
      )}
      <button
        type="button"
        onClick={del}
        disabled={pending}
        aria-label={t("qbo_delete")}
        title={t("qbo_delete")}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        )}
        {t("qbo_delete")}
      </button>
    </div>
  );
}
