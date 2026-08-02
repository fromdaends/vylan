"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Eye, SkipForward, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  bulkApproveBucketAction,
  requestOrganizeScanAction,
  reviewSuggestionAction,
  type ReviewDecision,
} from "@/app/actions/organize";
import type { OrganizeBucket } from "@/lib/files/organize";

// The review queue's client side. One row per suggestion: current → proposed,
// Luna's one-line reason, a preview toggle, and three COMPACT icon actions
// (approve / skip / dismiss) — per-item controls, the founder's standing
// preference. Approve fires the same server actions manual work uses; skip
// may return next scan; dismiss is forever.

export type ReviewRow = {
  id: string;
  bucket: OrganizeBucket;
  name: string;
  clientName: string;
  currentLabel: string;
  proposedLabel: string;
  reasoning: string | null;
  previewUrl: string;
};

export function OrganizeRow({ row }: { row: ReviewRow }) {
  const t = useTranslations("Files");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showPreview, setShowPreview] = useState(false);
  const [gone, setGone] = useState(false);

  function decide(decision: ReviewDecision) {
    startTransition(async () => {
      const res = await reviewSuggestionAction({ id: row.id, decision });
      if (res.ok) {
        setGone(true);
        toast.success(
          decision === "approve"
            ? t("organize_applied")
            : decision === "skip"
              ? t("organize_skipped")
              : t("organize_dismissed"),
        );
      } else if (res.error === "expired") {
        setGone(true);
        toast.info(t("organize_expired"));
      } else {
        toast.error(t("action_failed"));
      }
      router.refresh();
    });
  }

  if (gone) return null;

  return (
    <li className={cn("px-4 py-3", pending && "opacity-50")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.clientName}</p>
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">{row.currentLabel}</span>
            <span className="mx-1.5 text-muted-foreground/60">→</span>
            <span className="font-medium text-foreground">{row.proposedLabel}</span>
          </p>
          {row.reasoning && (
            <p className="mt-0.5 truncate text-xs italic text-muted-foreground">
              {row.reasoning}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconAction
            label={t("organize_preview")}
            onClick={() => setShowPreview((v) => !v)}
            active={showPreview}
          >
            <Eye className="size-4" aria-hidden />
          </IconAction>
          <IconAction
            label={t("organize_approve")}
            onClick={() => decide("approve")}
            disabled={pending}
            tone="approve"
          >
            <Check className="size-4" aria-hidden />
          </IconAction>
          <IconAction
            label={t("organize_skip")}
            onClick={() => decide("skip")}
            disabled={pending}
          >
            <SkipForward className="size-4" aria-hidden />
          </IconAction>
          <IconAction
            label={t("organize_dismiss")}
            onClick={() => decide("dismiss")}
            disabled={pending}
            tone="dismiss"
          >
            <X className="size-4" aria-hidden />
          </IconAction>
        </div>
      </div>
      {showPreview && (
        <iframe
          src={row.previewUrl}
          title={row.name}
          className="mt-3 h-96 w-full rounded-md border border-border/70 bg-background"
        />
      )}
    </li>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  active,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "approve" | "dismiss";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        active && "bg-muted text-foreground",
        tone === "approve" && "hover:border-primary/40 hover:text-primary",
        tone === "dismiss" && "hover:border-destructive/40 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}

/** Per-bucket bulk approve. First click arms it into an explicit confirm that
 * STATES exactly what will change; second click executes. */
export function BulkApproveButton({
  bucket,
  count,
  confirmLabel,
}: {
  bucket: OrganizeBucket;
  count: number;
  /** "Move 12 files" / "Soft-delete 3 duplicates" — built server-side so the
   * consequence is exact, not generic. */
  confirmLabel: string;
}) {
  const t = useTranslations("Files");
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (count === 0) return null;

  if (!armed) {
    return (
      <Button variant="outline" size="sm" onClick={() => setArmed(true)}>
        {t("organize_bulk_approve", { count })}
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await bulkApproveBucketAction({ bucket });
            setArmed(false);
            router.refresh();
            if (res.expired > 0 || res.failed > 0) {
              toast.warning(
                t("organize_bulk_partial", {
                  approved: res.approved,
                  rest: res.expired + res.failed,
                }),
              );
            } else {
              toast.success(t("organize_bulk_done", { approved: res.approved }));
            }
          })
        }
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setArmed(false)}>
        {t("organize_cancel")}
      </Button>
    </span>
  );
}

/** Queue an on-demand scan. The cron picks it up within ~2 minutes. */
export function ScanNowButton() {
  const t = useTranslations("Files");
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await requestOrganizeScanAction();
          if (res.ok) toast.success(t("organize_scan_queued"));
          else toast.error(t("action_failed"));
        })
      }
    >
      {t("organize_scan_now")}
    </Button>
  );
}
