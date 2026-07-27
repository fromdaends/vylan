import { CheckCircle2, AlertTriangle, FileText } from "lucide-react";
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

// The model returns its verdict as ONE sentence that often carries several
// separate facts welded together with semicolons ("…the four-page statement is
// present; File 2 is a duplicate copy of pages 1 to 3"). An accountant scanning
// a checklist reads lines, not paragraphs, so split it back into its points.
//
// Splits on semicolons and on sentence boundaries (". " followed by a capital),
// but NOT on the periods inside abbreviations, decimals, or dates — hence the
// capital-letter requirement rather than a bare /\./.
export function splitConclusionPoints(text: string): string[] {
  return text
    .split(/\s*;\s*|(?<=\.)\s+(?=[A-Z(])/)
    .map((part) => part.trim().replace(/[;,]+$/, "").trim())
    .filter((part) => part.length > 0);
}

export function SetSummaryLine({
  assessment,
  locale,
  className,
}: {
  assessment: SetAssessment;
  locale: "fr" | "en";
  className?: string;
}) {
  const text =
    locale === "fr"
      ? assessment.conclusion_fr || assessment.conclusion_en
      : assessment.conclusion_en || assessment.conclusion_fr;
  if (!text) return null;

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

  // One line per fact, not one paragraph.
  const points = splitConclusionPoints(text);
  const heading = locale === "fr" ? "Résumé du document" : "Document summary";

  // A bordered card in ONE fixed neutral colour — deliberately NOT tinted by
  // the verdict (founder). A green box with a green tick reads as "this whole
  // item is fine", which is a claim the summary shouldn't make: the set can be
  // complete while a file inside it still needs review. The box is a container
  // for information; the per-file rows and status badges carry the judgement.
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed",
        className,
      )}
    >
      {/* Label only — no confidence score. */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
          {heading}
        </span>
      </div>

      {/* The model's verdict, split into its separate points — one fact per
          line. Neutral markers throughout: these are observations, not
          approvals. */}
      <ul className="space-y-1">
        {points.map((point, i) => (
          <li key={`p-${i}`} className="flex items-start gap-1.5">
            <span
              className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/60"
              aria-hidden
            />
            <span className="min-w-0 text-foreground/80">{point}</span>
          </li>
        ))}
      </ul>

      {/* Checked-by-arithmetic rows, separated from the model's prose above. */}
      {hasRows && (
        <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
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
