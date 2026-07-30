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
  // "We compared 16 of your 100 files" must reach the accountant even when
  // nothing else about the set warrants a line. Silence here is the failure
  // mode: a partial comparison that looks exactly like a complete one.
  if (setComparisonShortfall(assessment) != null) return true;
  return (
    fileCount > 1 ||
    assessment.outcome === "incomplete" ||
    assessment.outcome === "unplaceable"
  );
}

// PURE: how many of the item's files were left out of the cross-file check, or
// null when it covered everything.
//
// Only ever reports a shortfall it can prove from two present, sane numbers —
// assessments written before these counts existed, or with nonsense in them,
// report nothing rather than inventing a warning.
export function setComparisonShortfall(
  assessment: Pick<SetAssessment, "reviewed_file_count" | "total_file_count">,
): { reviewed: number; total: number } | null {
  const reviewed = assessment.reviewed_file_count;
  const total = assessment.total_file_count;
  if (typeof reviewed !== "number" || typeof total !== "number") return null;
  if (!Number.isFinite(reviewed) || !Number.isFinite(total)) return null;
  if (reviewed < 0 || total <= reviewed) return null;
  return { reviewed, total };
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
  // Strict incompleteness: the partial copy was auto-rejected and the client
  // asked to re-send the complete document — say so, or the accountant sees
  // rejected files appear "by themselves".
  const autoRejected = assessment.auto_rejected_incomplete === true;
  // The cross-file check can only carry so many files in one pass. When the
  // item holds more, the accountant is told exactly how many were compared —
  // otherwise a check covering 16 of 100 files reads as covering all 100.
  const shortfall = setComparisonShortfall(assessment);
  const hasRows =
    findings.length > 0 ||
    coverage.length > 0 ||
    autoRejected ||
    shortfall != null;

  // One line per fact, not one paragraph.
  const points = splitConclusionPoints(text);
  // Named for the QUESTION this block answers — "do these files, together, add
  // up to the complete document?" — not for one of its answers. It covers
  // missing pages, duplicates, files that can't be placed, and (for statements)
  // missing months or balances that don't chain, so anything narrower like
  // "Missing pages" would be wrong the moment it reports a duplicate.
  const heading =
    locale === "fr" ? "Contrôle d’intégralité" : "Completeness check";

  // A bordered card in ONE fixed BRAND-BLUE tint — deliberately NOT tinted by
  // the verdict (founder). Blue makes the block stand out on a long checklist
  // while staying neutral about the outcome: a green box with a green tick
  // reads as "this whole item is fine", which is a claim the summary shouldn't
  // make (the set can be complete while a file inside it still needs review).
  // The box is a container for information; the per-file rows and status badge
  // carry the judgement.
  return (
    <div
      className={cn(
        "rounded-lg border border-accent/30 bg-accent-subtle px-3 py-2 text-xs leading-relaxed",
        className,
      )}
    >
      {/* Label only — no confidence score. */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <FileText className="size-3.5 shrink-0 text-accent" aria-hidden />
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
              className="mt-[7px] size-1 shrink-0 rounded-full bg-accent/70"
              aria-hidden
            />
            <span className="min-w-0 text-foreground/80">{point}</span>
          </li>
        ))}
      </ul>

      {/* Checked-by-arithmetic rows, separated from the model's prose above. */}
      {hasRows && (
        <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
          {/* FIRST, above every finding: how much of the item this check
              actually covered. A missing-page verdict drawn from 16 of 100
              files means something different from one drawn from all 100, and
              the accountant has to know which they are reading before they
              read it. */}
          {shortfall && (
            <div className="flex items-start gap-1.5">
              <AlertTriangle
                className="mt-px size-3.5 shrink-0 text-warning"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="font-medium text-warning">
                  {locale === "fr"
                    ? `${shortfall.reviewed} des ${shortfall.total} fichiers comparés entre eux`
                    : `${shortfall.reviewed} of ${shortfall.total} files compared together`}
                </div>
                <div className="text-muted-foreground">
                  {locale === "fr"
                    ? `Chaque fichier a été lu individuellement, mais les ${shortfall.total - shortfall.reviewed} autres n’ont pas été comparés au reste : pages manquantes, mois non couverts et soldes qui ne se suivent pas peuvent leur avoir échappé. À vérifier à la main.`
                    : `Every file was read on its own, but the other ${shortfall.total - shortfall.reviewed} were not compared against the rest — missing pages, uncovered months and balances that don't follow on could have been missed among them. Worth a manual look.`}
                </div>
              </div>
            </div>
          )}
          {autoRejected && (
            <div className="flex items-start gap-1.5">
              <AlertTriangle
                className="mt-px size-3.5 shrink-0 text-warning"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="font-medium text-warning">
                  {locale === "fr"
                    ? "Copie incomplète retournée au client"
                    : "Incomplete copy sent back to the client"}
                </div>
                <div className="text-muted-foreground">
                  {locale === "fr"
                    ? "Les pages reçues ont été refusées automatiquement et le client a été invité à renvoyer le document complet."
                    : "The received pages were rejected automatically and the client was asked to re-send the complete document."}
                </div>
              </div>
            </div>
          )}
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
