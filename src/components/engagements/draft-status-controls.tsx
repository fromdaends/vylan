"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Ban, RotateCcw, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DraftStatus } from "@/lib/quickbooks/draft-status";

// Approve / Dismiss / Reopen controls on a QuickBooks draft card (Stage 4,
// Phase 2). Posts to the STABLE status endpoint (deploy-skew-proof) and refreshes
// the page on success. Still READ-ONLY on QuickBooks; this only records the
// accountant's decision (nothing is posted until Stage 5).
//
//   draft     -> Approve (disabled until the draft is complete) + Dismiss
//   approved  -> Reopen
//   dismissed -> Reopen
export function DraftStatusControls({
  fileId,
  status,
  canApprove,
}: {
  fileId: string;
  status: DraftStatus;
  // Whether the draft is complete enough to approve (drives the disabled state).
  canApprove: boolean;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function move(next: DraftStatus) {
    setFailed(false);
    startTransition(async () => {
      try {
        const r = await fetch(
          `/api/quickbooks/suggestions/${fileId}/status`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: next }),
          },
        );
        const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        if (r.ok && res?.ok) router.refresh();
        else setFailed(true);
      } catch {
        setFailed(true);
      }
    });
  }

  const spinner = (
    <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
  );

  return (
    <div className="flex items-center gap-2">
      {failed && (
        <span role="alert" className="text-[11px] text-warning">
          {t("status_failed")}
        </span>
      )}
      {status === "draft" ? (
        <>
          <button
            type="button"
            onClick={() => move("dismissed")}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            {pending ? spinner : <Ban className="h-3 w-3" aria-hidden="true" />}
            {t("dismiss")}
          </button>
          <button
            type="button"
            onClick={() => move("approved")}
            disabled={pending || !canApprove}
            title={!canApprove ? t("approve_blocked_hint") : undefined}
            aria-label={!canApprove ? t("approve_blocked_hint") : t("approve")}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
              "bg-success/10 text-success hover:bg-success/20",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-success/10",
            )}
          >
            {pending ? spinner : <Check className="h-3 w-3" aria-hidden="true" />}
            {t("approve")}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => move("draft")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          {pending ? spinner : <RotateCcw className="h-3 w-3" aria-hidden="true" />}
          {t("reopen")}
        </button>
      )}
    </div>
  );
}
