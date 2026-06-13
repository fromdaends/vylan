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
  return (
    fileCount > 1 ||
    assessment.outcome === "incomplete" ||
    assessment.outcome === "unplaceable"
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

  return (
    <div
      className={cn(
        "flex items-start gap-1.5 text-xs leading-relaxed",
        tone.color,
        className,
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 text-foreground/80">{text}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}
