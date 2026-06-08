"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatCurrency, type AppLocale } from "@/lib/format";
import { matchDocument, type MatchFlag } from "@/lib/ai/matching";
import { DOC_TYPE_LABELS, docTypeLabel } from "@/lib/doc-types";
import { previewCardTitle, type PreviewDoc, type PreviewStatus } from "./preview-model";
import { PreviewDocViewer } from "./preview-doc-viewer";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";

type ExtractedFields = {
  extracted_year?: number | null;
  reasoning?: string | null;
  key_identifiers?: string[] | null;
  issuer_name?: string | null;
  party_name?: string | null;
  account_or_period?: string | null;
  form_identifier?: string | null;
  amounts?: { label: string; value: number }[] | null;
  fields_confidence?: number | null;
};

const STATUS_PILL: Record<
  PreviewStatus,
  { cls: string; Icon: typeof CheckCircle2 }
> = {
  approved: {
    cls: "border-success/40 bg-success/10 text-success",
    Icon: CheckCircle2,
  },
  flagged: {
    cls: "border-warning/40 bg-warning/10 text-warning",
    Icon: AlertTriangle,
  },
  rejected: {
    cls: "border-destructive/40 bg-destructive/10 text-destructive",
    Icon: XCircle,
  },
  pending: {
    cls: "border-border/50 bg-muted/40 text-muted-foreground",
    Icon: Clock,
  },
};

// The click-in detail: the document on one side, the AI's full read on the
// other, at ~half the panel each, with a fullscreen toggle for the document and
// approve / reject / download right in the top bar. Renders over the grid inside
// the same overlay panel (the grid stays mounted underneath, state preserved).
export function PreviewDetail({
  doc,
  file,
  expectedDocType,
  expectedYear,
  clientName,
  locale,
  pending,
  onApprove,
  onReject,
  onBack,
  onCloseOverlay,
}: {
  doc: PreviewDoc;
  file: UploadedFile;
  expectedDocType: DocType;
  expectedYear: number | null;
  clientName: string | null;
  locale: AppLocale;
  pending: boolean;
  onApprove: () => void;
  onReject: () => void;
  onBack: () => void;
  onCloseOverlay: () => void;
}) {
  const t = useTranslations("Preview");
  const tAi = useTranslations("Ai");
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Move focus into the detail when it opens, so keyboard users land on the
  // document's actions rather than behind the panel.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const header = previewCardTitle(doc, locale);
  const pill = STATUS_PILL[doc.status];
  const statusLabel = t(`status_${doc.status}`);

  const fields = (file.ai_extracted_fields ?? {}) as ExtractedFields;
  const classification = file.ai_classification;
  const conf = file.ai_confidence;
  const verdict = file.ai_usability;
  const typeName =
    classification && classification !== "unknown" && classification in DOC_TYPE_LABELS
      ? docTypeLabel(classification as DocType, locale)
      : null;

  const flags: MatchFlag[] =
    classification && conf != null
      ? matchDocument({
          expectedDocType,
          expectedYear,
          clientName,
          classification: {
            document_type: classification as DocType | "unknown",
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
        })
      : [];

  const qualitySummary = verdict
    ? locale === "fr"
      ? verdict.issue_summary_fr || verdict.issue_summary_en
      : verdict.issue_summary_en || verdict.issue_summary_fr
    : null;

  const detailRows: { label: string; value: string }[] = [];
  if (fields.party_name)
    detailRows.push({ label: tAi("detail_name"), value: fields.party_name });
  if (fields.issuer_name)
    detailRows.push({ label: tAi("detail_issuer"), value: fields.issuer_name });
  if (typeof fields.extracted_year === "number")
    detailRows.push({
      label: tAi("detail_year"),
      value: String(fields.extracted_year),
    });
  if (fields.account_or_period)
    detailRows.push({
      label: tAi("detail_period"),
      value: fields.account_or_period,
    });
  if (fields.form_identifier)
    detailRows.push({ label: tAi("detail_form"), value: fields.form_identifier });

  const amounts = Array.isArray(fields.amounts) ? fields.amounts : [];
  const identifiers = Array.isArray(fields.key_identifiers)
    ? fields.key_identifiers
    : [];

  function flagText(f: MatchFlag): string {
    if (f.kind === "type_mismatch")
      return tAi("mismatch", {
        expected: f.expected.toUpperCase(),
        detected: f.actual.toUpperCase(),
      });
    if (f.kind === "year_mismatch")
      return tAi("year_mismatch", { expected: f.expected, actual: f.actual });
    return tAi("identity_mismatch", { expected: f.expected, actual: f.actual });
  }

  const hasAnyAi = typeName != null || verdict != null || detailRows.length > 0;

  return (
    // Opaque, top-of-panel layer that fully covers the grid. z-30 sits above
    // the grid cards' inner badges/quick-actions (z-20); paired with each card
    // now being `isolate` (so those z-20 children are contained), nothing from
    // the grid can bleed through. bg-background is fully opaque. Keep z > 20.
    <div
      ref={rootRef}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col bg-background outline-none"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label={t("back")}
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">{t("back")}</span>
          </Button>
          <span className="hidden max-w-[22ch] truncate text-sm font-semibold sm:block">
            {header}
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
              pill.cls,
            )}
          >
            <pill.Icon className="size-3" aria-hidden />
            {statusLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onApprove}
            aria-label={t("approve")}
            className="hover:border-success/40 hover:bg-success hover:text-white"
          >
            <CheckCircle2 className="size-4" />
            <span className="hidden sm:inline">{t("approve")}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onReject}
            aria-label={t("reject")}
            className="hover:border-destructive/40 hover:bg-destructive hover:text-white"
          >
            <X className="size-4" />
            <span className="hidden sm:inline">{t("reject")}</span>
          </Button>
          <a
            href={`/api/files/${doc.fileId}?download=1`}
            download
            className="inline-flex"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("download")}
            >
              <Download className="size-4" />
            </Button>
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("close")}
            onClick={onCloseOverlay}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Split body */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Document */}
        <div
          className={cn(
            "relative min-h-0 shrink-0",
            fullscreen
              ? "h-full w-full"
              : "h-[45vh] w-full md:h-auto md:w-[58%] md:shrink md:border-r md:border-border/40",
          )}
        >
          <PreviewDocViewer
            fileId={doc.fileId}
            isImage={doc.isImage}
            isPdf={doc.isPdf}
            fileName={doc.fileName}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={fullscreen ? t("exit_fullscreen") : t("fullscreen")}
            onClick={() => setFullscreen((f) => !f)}
            className="absolute top-2 right-2 bg-background/80 backdrop-blur"
          >
            {fullscreen ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        </div>

        {/* AI summary */}
        {!fullscreen && (
          <div className="min-h-0 w-full flex-1 space-y-4 overflow-y-auto p-4 md:w-[42%] md:flex-none">
            <section>
              <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <Sparkles className="size-3.5" aria-hidden />
                {tAi("label")}
              </div>
              {typeName ? (
                <div className="mt-1">
                  <div className="text-sm font-semibold text-foreground">
                    {typeName}
                  </div>
                  {conf != null && (
                    <div className="text-xs text-muted-foreground">
                      {t("confidence", { percent: Math.round(conf * 100) })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-sm text-muted-foreground">
                  {t("status_pending")}
                </div>
              )}
            </section>

            {verdict && (
              <section
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  verdict.usable
                    ? "border-success/40 bg-success/5"
                    : "border-warning/40 bg-warning/5",
                )}
              >
                <div
                  className={cn(
                    "flex items-center gap-1.5 font-medium",
                    verdict.usable ? "text-success" : "text-warning",
                  )}
                >
                  {verdict.usable ? (
                    <CheckCircle2 className="size-4" aria-hidden />
                  ) : (
                    <AlertTriangle className="size-4" aria-hidden />
                  )}
                  {verdict.usable ? t("quality_ok") : t("quality_issue")}
                </div>
                {!verdict.usable && qualitySummary && (
                  <p className="mt-1 text-muted-foreground">{qualitySummary}</p>
                )}
              </section>
            )}

            {flags.length > 0 && (
              <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="flex items-center gap-1.5 font-medium text-destructive">
                  <AlertTriangle className="size-4" aria-hidden />
                  {t("flags_heading")}
                </div>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {flags.map((f) => (
                    <li key={f.kind}>{flagText(f)}</li>
                  ))}
                </ul>
              </section>
            )}

            {detailRows.length > 0 && (
              <section>
                <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t("details_heading")}
                </h4>
                <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                  {detailRows.map((r) => (
                    <Fragment key={r.label}>
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="text-foreground">{r.value}</dd>
                    </Fragment>
                  ))}
                </dl>
              </section>
            )}

            {amounts.length > 0 && (
              <section>
                <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {tAi("detail_amounts")}
                </h4>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {amounts.map((a, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate text-muted-foreground">
                        {a.label}
                      </span>
                      <span className="shrink-0 font-mono">
                        {formatCurrency(a.value, locale, 2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(fields.reasoning || identifiers.length > 0) && (
              <section className="space-y-1.5 text-sm text-muted-foreground">
                {fields.reasoning && (
                  <p>
                    <span className="font-medium text-foreground/80">
                      {tAi("detail_why")}:
                    </span>{" "}
                    {fields.reasoning}
                  </p>
                )}
                {identifiers.length > 0 && (
                  <p>
                    <span className="font-medium text-foreground/80">
                      {tAi("detail_read")}:
                    </span>{" "}
                    {identifiers.join(", ")}
                  </p>
                )}
              </section>
            )}

            {!hasAnyAi && (
              <p className="text-sm text-muted-foreground">{t("no_ai_yet")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
