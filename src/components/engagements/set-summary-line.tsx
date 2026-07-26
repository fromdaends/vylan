import { CheckCircle2, AlertTriangle, HelpCircle, Files } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SetAssessment } from "@/lib/ai/set-assessment";

// One plain, item-level line summarizing the SET assessment (all of an item's
// files judged together) for the ACCOUNTANT — shown in the engagement item
// header and the Preview group header. The client never sees this (no scores,
// no internal verdicts on the portal). Deliberately hook-free + translation-free
// (the conclusion text is already bilingual in the data) so the SAME component
// renders inside both the server-rendered checklist and the client Preview.

// Whether the set line is worth showing: a real multi-file set always, plus any
// single-file item whose verdict needs attention (incomplete / unplaceable).
// A lone, complete single file adds nothing the per-file row doesn't already say.
export function shouldShowSetLine(
  assessment: SetAssessment | null | undefined,
  fileCount: number,
): assessment is SetAssessment {
  if (!assessment) return false;
  // A cross-statement finding (balances that don't chain, a missing month) is
  // the whole reason the check exists, and it can land on a SINGLE file whose
  // pages are all present — a year of statements in one PDF with a month
  // missing is outcome "complete" with fileCount 1. Without this the finding
  // would be computed and then never displayed, which is exactly the headline
  // bookkeeping case.
  if ((assessment.chain_findings?.length ?? 0) > 0) return true;
  return (
    fileCount > 1 ||
    assessment.outcome === "incomplete" ||
    assessment.outcome === "unplaceable"
  );
}

// A "missing page" block: the item rolled up to "rejected" purely because the
// set is incomplete and the client is being asked for the page (NOT because a
// file was rejected — those carry a rejection_reason). Lets the accountant UI
// label it "Missing page" instead of the misleading "Rejected", and offer
// approve/reject rather than reopen.
export function isMissingPageBlock(item: {
  status: string;
  rejection_reason: string | null;
  ai_set_assessment: SetAssessment | null;
}): boolean {
  return (
    item.status === "rejected" &&
    !item.rejection_reason &&
    item.ai_set_assessment?.outcome === "incomplete" &&
    item.ai_set_assessment?.needs_client === true
  );
}

const TONE = {
  complete: { icon: CheckCircle2, color: "text-success" },
  incomplete: { icon: AlertTriangle, color: "text-warning" },
  unplaceable: { icon: HelpCircle, color: "text-warning" },
  not_a_set: { icon: Files, color: "text-muted-foreground" },
} as const;

export function SetSummaryLine({
  assessment,
  locale,
  className,
}: {
  assessment: SetAssessment;
  locale: "fr" | "en";
  className?: string;
}) {
  const tone = TONE[assessment.outcome] ?? TONE.not_a_set;
  const Icon = tone.icon;
  const text =
    locale === "fr"
      ? assessment.conclusion_fr || assessment.conclusion_en
      : assessment.conclusion_en || assessment.conclusion_fr;
  if (!text) return null;
  // Confidence as a compact percentage, matching the per-file "94%" the
  // accountant already reads elsewhere. Shown only as supporting context.
  const pct = Math.round(Math.max(0, Math.min(1, assessment.confidence)) * 100);

  // Cross-statement arithmetic results (statement-chain.ts). These are
  // CODE-verified facts — a balance that doesn't chain, a hole between
  // statement periods — so they are presented as their own labelled rows under
  // a divider, NOT blended into the model's prose. Each row is a bold heading
  // ("Statement missing") plus a muted detail line, so an accountant scanning a
  // long checklist reads the headings and only drops into the specifics when
  // one matters. Capped so a pathological set can't flood the header.
  const findings = (assessment.chain_findings ?? []).slice(0, 3);
  // Coverage is quiet reassurance, so it only earns a row when there are
  // several statements to summarize — and never in warning colours.
  const coverage = (assessment.chain_coverage ?? [])
    .filter((c) => c.statements >= 3)
    .slice(0, 2);
  const L = (t: { label_en: string; label_fr: string }) =>
    locale === "fr" ? t.label_fr || t.label_en : t.label_en || t.label_fr;
  const D = (t: { detail_en: string; detail_fr: string }) =>
    locale === "fr" ? t.detail_fr || t.detail_en : t.detail_en || t.detail_fr;
  const hasRows = findings.length > 0 || coverage.length > 0;

  return (
    <div className={cn("text-xs leading-relaxed", className)}>
      {/* The model's own verdict. */}
      <div className={cn("flex items-start gap-1.5", tone.color)}>
        <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 text-foreground/80">{text}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{pct}%</span>
      </div>

      {/* Checked-by-arithmetic rows, visually separated from the prose above. */}
      {hasRows && (
        <div className="mt-1.5 space-y-1.5 border-t border-border/60 pt-1.5">
          {findings.map((f, i) => (
            <div key={`cf-${i}`} className="flex items-start gap-1.5">
              <AlertTriangle
                className="mt-px size-3.5 shrink-0 text-warning"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="font-medium text-warning">{L(f)}</div>
                <div className="text-muted-foreground">{D(f)}</div>
              </div>
            </div>
          ))}
          {findings.length === 0 &&
            coverage.map((c, i) => (
              <div key={`cc-${i}`} className="flex items-start gap-1.5">
                <CheckCircle2
                  className="mt-px size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="font-medium text-foreground/70">{L(c)}</div>
                  <div className="text-muted-foreground">{D(c)}</div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
