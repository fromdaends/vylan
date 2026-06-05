"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { overrideAiRejection } from "@/app/actions/usability-override";
import type { UsabilityVerdict } from "@/lib/ai/usability";
import type { AppLocale } from "@/lib/format";

type BadgeState =
  | "auto_rejected"
  | "escalated"
  | "flagged"; // queue-for-accountant OR low-confidence warning

function pickState(
  verdict: UsabilityVerdict,
  aiRejected: boolean,
  rejectionCount: number,
): BadgeState | null {
  // No verdict, or the AI thinks the file is fine → no badge.
  if (verdict.usable) return null;
  if (rejectionCount >= 2 && aiRejected) return "escalated";
  if (aiRejected) return "auto_rejected";
  // AI says unusable but the system didn't auto-act (firm flag off,
  // or confidence under threshold). Surface for review.
  return "flagged";
}

export function UsabilityBadge({
  fileId,
  verdict,
  aiRejected,
  rejectionCount,
}: {
  fileId: string;
  verdict: UsabilityVerdict | null;
  aiRejected: boolean;
  rejectionCount: number;
}) {
  const t = useTranslations("Usability");
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [overridden, setOverridden] = useState(false);

  if (!verdict) return null;
  const state = pickState(verdict, aiRejected, rejectionCount);
  if (!state) return null;
  // Once an override has been applied, hide the badge so the row
  // reads as "approved" without a stale rejection chip lingering.
  if (overridden) return null;

  const style = stateStyle(state);
  const Icon = state === "escalated" ? ShieldAlert : Sparkles;
  const localizedSummary =
    locale === "fr"
      ? verdict.issue_summary_fr || verdict.issue_summary_en
      : verdict.issue_summary_en || verdict.issue_summary_fr;

  function onOverrideConfirm() {
    const fd = new FormData();
    fd.append("file_id", fileId);
    startTransition(async () => {
      const res = await overrideAiRejection(null, fd);
      if (res.ok) {
        setOverridden(true);
        setConfirmOpen(false);
        setOpen(false);
      }
    });
  }

  return (
    <div className={`rounded-md border ${style.border} ${style.bg} text-xs`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className={`size-3 ${style.text}`} aria-hidden />
        ) : (
          <ChevronRight className={`size-3 ${style.text}`} aria-hidden />
        )}
        <Icon className={`size-3 ${style.text}`} aria-hidden />
        <span
          className={`font-medium uppercase tracking-wide text-[10px] ${style.text}`}
        >
          {t("label")}
        </span>
        <span className={`font-medium ${style.text}`}>
          {t(`state_${state}`)}
        </span>
        {localizedSummary && (
          <span className={`${style.text} truncate flex-1 min-w-0`}>
            — {localizedSummary}
          </span>
        )}
        <span className={`font-mono ${style.text}/70 ml-auto`}>
          {Math.round(verdict.confidence * 100)}%
        </span>
      </button>

      {open && (
        <div className={`border-t ${style.border} px-3 py-2.5 space-y-2`}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t("primary_issue")}</dt>
            <dd>
              {verdict.primary_issue
                ? t(`issue_${verdict.primary_issue}`)
                : "—"}
            </dd>
            <dt className="text-muted-foreground">{t("confidence")}</dt>
            <dd className="font-mono">
              {Math.round(verdict.confidence * 100)}%
            </dd>
            {localizedSummary && (
              <>
                <dt className="text-muted-foreground">
                  {state === "auto_rejected"
                    ? t("client_message")
                    : t("reason")}
                </dt>
                {/* Full, untruncated reason — the collapsed header clips it. */}
                <dd className="italic">&ldquo;{localizedSummary}&rdquo;</dd>
              </>
            )}
            {state === "escalated" && (
              <>
                <dt className="text-muted-foreground">{t("strikes")}</dt>
                <dd>{t("strikes_value", { count: rejectionCount })}</dd>
              </>
            )}
          </dl>
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t("ai_was_right")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(true)}
            >
              {t("ai_was_wrong")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirm_title")}</DialogTitle>
            <DialogDescription>{t("confirm_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              {t("confirm_cancel")}
            </Button>
            <Button
              type="button"
              onClick={onOverrideConfirm}
              disabled={pending}
            >
              {pending ? t("confirm_pending") : t("confirm_approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function stateStyle(state: BadgeState): {
  border: string;
  bg: string;
  text: string;
} {
  switch (state) {
    case "auto_rejected":
      // Orange — system already messaged the client.
      return {
        border: "border-warning/40",
        bg: "bg-warning/5",
        text: "text-warning",
      };
    case "escalated":
      // Red — two strikes hit, needs human eyes.
      return {
        border: "border-destructive/40",
        bg: "bg-destructive/5",
        text: "text-destructive",
      };
    case "flagged":
    default:
      // Yellow — accountant should glance at it.
      return {
        border: "border-amber-500/40",
        bg: "bg-amber-500/5",
        text: "text-amber-600 dark:text-amber-400",
      };
  }
}

// Internal helper exported only for testing.
export const __test = { pickState };

// Silence "unused" warnings for icon imports retained for future use.
void AlertTriangle;
