"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Loader2,
  Sparkles,
  TriangleAlert,
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
import { matchDocument } from "@/lib/ai/matching";
import {
  pickAiHeadline,
  type AiHeadlineTone,
} from "@/lib/engagements/file-ai-headline";
import { cn } from "@/lib/cn";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";
import type { AppLocale } from "@/lib/format";

// One-glance AI verdict for a scanned file on the engagement checklist. Replaces
// the old two stacked panels (usability + type) with a single compact line: a
// coloured status, a short detail, and the confidence — collapsed by default.
// The deep read (reasoning, every extracted field, amounts, second guess) lives
// on the Preview page now; here we keep only what an accountant needs to triage
// the row, plus the "AI was wrong → approve" override behind one expand.

type ExtractedFields = {
  extracted_year?: number | null;
  looks_correct?: boolean | null;
  issue_if_any?: string | null;
  issuer_name?: string | null;
  party_name?: string | null;
};

// How long a never-run analysis stays "in flight" before we call it stale and
// show a calm "Not analyzed" instead of an eternal spinner. Mirrors AiBadge.
const ANALYSIS_FRESH_MS = 15 * 60 * 1000;

const TONE: Record<AiHeadlineTone, { dot: string; text: string; box: string }> =
  {
    good: {
      dot: "bg-success",
      text: "text-success",
      box: "border-success/20 bg-success/[0.05]",
    },
    warn: {
      dot: "bg-warning",
      text: "text-warning",
      box: "border-warning/20 bg-warning/[0.05]",
    },
    bad: {
      dot: "bg-destructive",
      text: "text-destructive",
      box: "border-destructive/20 bg-destructive/[0.05]",
    },
    neutral: {
      dot: "bg-muted-foreground/40",
      text: "text-muted-foreground",
      box: "border-border/40 bg-muted/30",
    },
  };

export function FileAiSummary({
  file,
  expectedDocType,
  expectedYear = null,
  clientName = null,
  rejectionCount,
}: {
  file: UploadedFile;
  expectedDocType: DocType;
  expectedYear?: number | null;
  clientName?: string | null;
  rejectionCount: number;
}) {
  const t = useTranslations("Ai");
  const tu = useTranslations("Usability");
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [overridden, setOverridden] = useState(false);
  const [mountedAt] = useState(() => Date.now());

  // Once the accountant overrides an AI rejection, drop the chip entirely so the
  // row reads as resolved (matches the old UsabilityBadge behaviour).
  if (overridden) return null;

  const analyzed = file.ai_classification != null && file.ai_confidence != null;

  // Not analyzed AND the accountant already decided → their call supersedes a
  // read that never finished; show nothing rather than a stale chip.
  if (
    !analyzed &&
    (file.review_status === "approved" || file.review_status === "rejected")
  ) {
    return null;
  }

  const fields = (file.ai_extracted_fields ?? {}) as ExtractedFields;
  const usable = file.ai_usability ? file.ai_usability.usable : null;
  const detected = file.ai_classification ?? "";
  const conf = file.ai_confidence ?? 0;
  const isUnknown = detected === "unknown";

  const flags = analyzed
    ? matchDocument({
        expectedDocType,
        expectedYear,
        clientName,
        classification: {
          document_type: detected as DocType | "unknown",
          confidence: conf,
          extracted_year:
            typeof fields.extracted_year === "number"
              ? fields.extracted_year
              : null,
          party_name:
            typeof fields.party_name === "string" ? fields.party_name : null,
          fields_confidence: 0,
        },
      })
    : [];
  const modelConcern =
    fields.looks_correct === false && typeof fields.issue_if_any === "string"
      ? fields.issue_if_any
      : null;
  const typeConcern = isUnknown || flags.length > 0 || modelConcern !== null;

  const stale =
    !analyzed &&
    mountedAt - new Date(file.uploaded_at).getTime() > ANALYSIS_FRESH_MS;

  const headline = pickAiHeadline({
    analyzed,
    stale,
    usable,
    aiRejected: file.ai_rejected,
    rejectionCount,
    typeConcern,
    lowConfidence: conf < 0.5,
  });
  const tone = TONE[headline.tone];

  const isUsabilityProblem =
    headline.kind === "auto_rejected" ||
    headline.kind === "escalated" ||
    headline.kind === "flagged";

  const localizedSummary = file.ai_usability
    ? locale === "fr"
      ? file.ai_usability.issue_summary_fr || file.ai_usability.issue_summary_en
      : file.ai_usability.issue_summary_en || file.ai_usability.issue_summary_fr
    : "";

  // Short, single-line detail next to the status. The full reason is in the
  // expand; this is just enough to triage without opening anything.
  const typeWord = detected ? detected.toUpperCase() : "";
  const year =
    typeof fields.extracted_year === "number"
      ? String(fields.extracted_year)
      : null;
  const detail = (() => {
    switch (headline.kind) {
      case "looks_right":
      case "low_confidence":
        return [typeWord, year].filter(Boolean).join(" · ");
      case "wrong_type":
        if (isUnknown)
          return t("not_a_document", {
            expected: expectedDocType.toUpperCase(),
          });
        if (flags[0]?.kind === "type_mismatch")
          return t("mismatch", {
            expected: flags[0].expected.toUpperCase(),
            detected: flags[0].actual.toUpperCase(),
          });
        return modelConcern ?? "";
      case "auto_rejected":
      case "escalated":
      case "flagged":
        return localizedSummary;
      default:
        return "";
    }
  })();

  const StatusIcon =
    headline.kind === "looks_right"
      ? CheckCircle2
      : headline.kind === "analyzing"
        ? Loader2
        : headline.kind === "not_analyzed"
          ? CircleHelp
          : isUsabilityProblem || headline.kind === "wrong_type"
            ? TriangleAlert
            : Sparkles;

  const statusLabel = t(`status_${headline.kind}`);

  // The single expand adds the full reason (for problems) and the key facts.
  const issuer =
    typeof fields.issuer_name === "string" ? fields.issuer_name : null;
  const party = typeof fields.party_name === "string" ? fields.party_name : null;
  const facts = [
    typeWord && `${t("detail_form")}: ${typeWord}`,
    year && `${t("detail_year")}: ${year}`,
    issuer && `${t("detail_issuer")}: ${issuer}`,
    !issuer && party && `${t("detail_name")}: ${party}`,
  ].filter(Boolean) as string[];
  const expandable = analyzed && (isUsabilityProblem || facts.length > 0);

  function onOverrideConfirm() {
    const fd = new FormData();
    fd.append("file_id", file.id);
    startTransition(async () => {
      const res = await overrideAiRejection(null, fd);
      if (res.ok) {
        setOverridden(true);
        setConfirmOpen(false);
        setOpen(false);
      }
    });
  }

  const header = (
    <>
      {expandable ? (
        open ? (
          <ChevronDown
            className={cn("size-3 shrink-0", tone.text)}
            aria-hidden
          />
        ) : (
          <ChevronRight
            className={cn("size-3 shrink-0", tone.text)}
            aria-hidden
          />
        )
      ) : (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", tone.dot)}
          aria-hidden
        />
      )}
      <StatusIcon
        className={cn(
          "size-3.5 shrink-0",
          tone.text,
          headline.kind === "analyzing" && "animate-spin",
        )}
        aria-hidden
      />
      <span className={cn("font-medium", tone.text)}>{statusLabel}</span>
      {detail && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          · {detail}
        </span>
      )}
      {headline.kind === "auto_rejected" && (
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t("client_notified")}
        </span>
      )}
      {analyzed && (
        <span
          className={cn(
            "ml-auto shrink-0 font-mono opacity-70",
            tone.text,
            detail && "ml-2",
          )}
        >
          {Math.round(conf * 100)}%
        </span>
      )}
    </>
  );

  return (
    <div className={cn("rounded-md border text-xs", tone.box)}>
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
        >
          {header}
        </button>
      ) : (
        <div className="flex w-full items-center gap-1.5 px-2 py-1.5">
          {header}
        </div>
      )}

      {open && expandable && (
        <div className={cn("space-y-2 border-t px-3 py-2", tone.box)}>
          {isUsabilityProblem && localizedSummary && (
            <p className="italic text-foreground/80">
              &ldquo;{localizedSummary}&rdquo;
            </p>
          )}
          {facts.length > 0 && (
            <p className="text-muted-foreground">{facts.join("  ·  ")}</p>
          )}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[11px] italic text-muted-foreground">
              {t("full_in_preview")}
            </span>
            {isUsabilityProblem && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
              >
                {t("override_approve")}
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tu("confirm_title")}</DialogTitle>
            <DialogDescription>{tu("confirm_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              {tu("confirm_cancel")}
            </Button>
            <Button type="button" onClick={onOverrideConfirm} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {pending ? tu("confirm_pending") : tu("confirm_approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
