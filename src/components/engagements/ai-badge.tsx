import { useLocale, useTranslations } from "next-intl";
import { Sparkles, AlertTriangle, Loader2 } from "lucide-react";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";
import { formatCurrency, type AppLocale } from "@/lib/format";

type ExtractedFields = {
  extracted_year?: number | null;
  extracted_amount_or_total?: number | null;
  looks_correct?: boolean | null;
  issue_if_any?: string | null;
};

export function AiBadge({
  file,
  expectedDocType,
}: {
  file: UploadedFile;
  expectedDocType: DocType;
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
  const looksCorrect = fields.looks_correct === true;
  const mismatch = detected !== expectedDocType && detected !== "unknown";
  const isWrong = mismatch || !looksCorrect;
  const lowConfidence = conf < 0.5;

  const bits: string[] = [];
  if (typeof fields.extracted_year === "number") {
    bits.push(String(fields.extracted_year));
  }
  if (typeof fields.extracted_amount_or_total === "number") {
    bits.push(formatCurrency(fields.extracted_amount_or_total, locale, 0));
  }

  // Wrong / mismatch — red alert.
  if (isWrong) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs space-y-1">
        <div className="inline-flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="size-3" />
          <span className="font-medium uppercase tracking-wide text-[10px]">
            {t("label")}
          </span>
          <span className="font-medium">
            {detected === "unknown"
              ? t("not_a_document", { expected: expectedDocType.toUpperCase() })
              : t("mismatch", {
                  expected: expectedDocType.toUpperCase(),
                  detected: detected.toUpperCase(),
                })}
          </span>
          <span className="font-mono text-destructive/70 ml-auto">
            {Math.round(conf * 100)}%
          </span>
        </div>
        {fields.issue_if_any && (
          <p className="text-destructive/90 leading-snug">
            {fields.issue_if_any}
          </p>
        )}
        <p className="text-muted-foreground text-[11px] italic">
          {t("advisory")}
        </p>
      </div>
    );
  }

  // Match — green (or amber if low confidence).
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

