import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Sparkles, AlertTriangle } from "lucide-react";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";

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
  if (file.ai_classification == null || file.ai_confidence == null) {
    return (
      <Badge variant="outline" className="text-xs font-normal">
        <Sparkles className="size-3" />
        {t("pending")}
      </Badge>
    );
  }

  const fields = (file.ai_extracted_fields ?? {}) as ExtractedFields;
  const detected = file.ai_classification;
  const conf = file.ai_confidence;
  const looksCorrect = fields.looks_correct === true;
  const mismatch = detected !== expectedDocType && detected !== "unknown";
  const lowConfidence = conf < 0.5;

  const bits: string[] = [];
  if (typeof fields.extracted_year === "number") {
    bits.push(String(fields.extracted_year));
  }
  if (typeof fields.extracted_amount_or_total === "number") {
    bits.push(formatCad(fields.extracted_amount_or_total));
  }
  const summary = bits.length > 0 ? " — " + bits.join(" · ") : "";

  if (mismatch || !looksCorrect) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="destructive">
          <AlertTriangle className="size-3" />
          {t("mismatch", {
            expected: expectedDocType.toUpperCase(),
            detected: detected.toUpperCase(),
          })}
        </Badge>
        {fields.issue_if_any && (
          <span className="text-destructive">{fields.issue_if_any}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Badge
        variant="secondary"
        className={
          lowConfidence
            ? "bg-warning/10 text-warning"
            : "bg-success/10 text-success"
        }
      >
        <Sparkles className="size-3" />
        {t("likely", { type: detected.toUpperCase() })}
        {summary}
      </Badge>
      <span className="font-mono text-muted-foreground">
        {Math.round(conf * 100)}%
      </span>
    </div>
  );
}

function formatCad(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}
