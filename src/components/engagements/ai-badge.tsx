import { useLocale, useTranslations } from "next-intl";
import { Sparkles, AlertTriangle, Loader2 } from "lucide-react";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";
import { formatCurrency, type AppLocale } from "@/lib/format";
import { matchDocument } from "@/lib/ai/matching";

type ExtractedFields = {
  extracted_year?: number | null;
  extracted_amount_or_total?: number | null;
  looks_correct?: boolean | null;
  issue_if_any?: string | null;
  // Phase 3 additions used by the Phase 4 matcher.
  party_name?: string | null;
  fields_confidence?: number | null;
};

// "AI" advisory callout for a single upload: what the document looks like, the
// key figures, and — Phase 4 — any expected-vs-actual MISMATCH (wrong type,
// wrong year, wrong person) as confidence-scored SUGGESTIONS. Never a decision:
// the accountant approves or dismisses. (Quality/usability is a separate
// badge.) expectedYear / clientName are optional so the comparison only runs
// when that context is known.
export function AiBadge({
  file,
  expectedDocType,
  expectedYear = null,
  clientName = null,
}: {
  file: UploadedFile;
  expectedDocType: DocType;
  expectedYear?: number | null;
  clientName?: string | null;
}) {
  const t = useTranslations("Ai");
  const locale = useLocale() as AppLocale;

  if (file.ai_classification == null || file.ai_confidence == null) {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
        title={t("pending_tooltip")}
      >
        <Loader2 className="size-3 animate-spin" />
        <span className="font-medium uppercase tracking-wide text-[10px]">
          {t("label")}
        </span>
        <span>{t("pending")}</span>
      </div>
    );
  }

  const fields = (file.ai_extracted_fields ?? {}) as ExtractedFields;
  const detected = file.ai_classification;
  const conf = file.ai_confidence;
  const isUnknown = detected === "unknown";

  // Phase 4: expected-vs-actual flags (pure, conservative — see matching.ts).
  const flags = matchDocument({
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
      fields_confidence:
        typeof fields.fields_confidence === "number"
          ? fields.fields_confidence
          : 0,
    },
  });

  // The model's own "this looks wrong for the slot" note (free text).
  const modelConcern =
    fields.looks_correct === false && typeof fields.issue_if_any === "string"
      ? fields.issue_if_any
      : null;

  const hasConcern = isUnknown || flags.length > 0 || modelConcern !== null;

  const bits: string[] = [];
  if (typeof fields.extracted_year === "number") {
    bits.push(String(fields.extracted_year));
  }
  if (typeof fields.extracted_amount_or_total === "number") {
    bits.push(formatCurrency(fields.extracted_amount_or_total, locale, 0));
  }

  // Something to flag — list each concern as a dismissible suggestion.
  if (hasConcern) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs space-y-1">
        <div className="flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="size-3 shrink-0" />
          <span className="font-medium uppercase tracking-wide text-[10px]">
            {t("label")}
          </span>
          <span className="font-medium">{t("review_heading")}</span>
          <span className="font-mono text-destructive/70 ml-auto">
            {Math.round(conf * 100)}%
          </span>
        </div>
        <ul className="space-y-0.5 text-destructive/90 leading-snug">
          {isUnknown && (
            <li>
              {t("not_a_document", { expected: expectedDocType.toUpperCase() })}
            </li>
          )}
          {flags.map((f) => (
            <li key={f.kind} className="flex items-baseline gap-1.5">
              <span className="flex-1">
                {f.kind === "type_mismatch"
                  ? t("mismatch", {
                      expected: f.expected.toUpperCase(),
                      detected: f.actual.toUpperCase(),
                    })
                  : f.kind === "year_mismatch"
                    ? t("year_mismatch", {
                        expected: f.expected,
                        actual: f.actual,
                      })
                    : t("identity_mismatch", {
                        expected: f.expected,
                        actual: f.actual,
                      })}
              </span>
              <span className="font-mono text-destructive/60 shrink-0">
                {Math.round(f.confidence * 100)}%
              </span>
            </li>
          ))}
          {modelConcern && <li>{modelConcern}</li>}
        </ul>
        <p className="text-muted-foreground text-[11px] italic">
          {t("advisory")}
        </p>
      </div>
    );
  }

  // Match — green (or amber if the classification itself was low-confidence).
  const lowConfidence = conf < 0.5;
  const tone = lowConfidence
    ? "border-warning/40 bg-warning/5 text-warning"
    : "border-success/40 bg-success/5 text-success";
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border ${tone} px-2 py-1 text-xs`}
      title={t("advisory")}
    >
      <Sparkles className="size-3" />
      <span className="font-medium uppercase tracking-wide text-[10px]">
        {t("label")}
      </span>
      <span className="font-medium">
        {t("likely", { type: detected.toUpperCase() })}
      </span>
      {bits.length > 0 && (
        <span className="text-muted-foreground">— {bits.join(" · ")}</span>
      )}
      <span className="font-mono text-muted-foreground ml-1">
        {Math.round(conf * 100)}%
      </span>
    </div>
  );
}
