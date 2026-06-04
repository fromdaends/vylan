"use client";

import { Fragment, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Sparkles,
  AlertTriangle,
  Loader2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";
import { formatCurrency, type AppLocale } from "@/lib/format";
import { matchDocument } from "@/lib/ai/matching";

type Amount = { label: string; value: number };
type ExtractedFields = {
  extracted_year?: number | null;
  extracted_amount_or_total?: number | null;
  looks_correct?: boolean | null;
  issue_if_any?: string | null;
  reasoning?: string | null;
  key_identifiers?: string[] | null;
  second_guess?: { document_type: string; confidence: number } | null;
  issuer_name?: string | null;
  party_name?: string | null;
  account_or_period?: string | null;
  form_identifier?: string | null;
  amounts?: Amount[] | null;
  fields_confidence?: number | null;
};

// "AI" advisory callout for one upload: a one-line headline (what it looks like
// + any expected-vs-actual mismatch flags, both always visible because they're
// actionable), with the rich read — why, the identifying text, the extracted
// fields + amounts, and an honest second guess — tucked behind an expand
// (progressive disclosure). Everything here is a SUGGESTION; the accountant
// decides. Quality/usability is a separate badge.
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
  const [open, setOpen] = useState(false);

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

  const modelConcern =
    fields.looks_correct === false && typeof fields.issue_if_any === "string"
      ? fields.issue_if_any
      : null;
  const hasConcern = isUnknown || flags.length > 0 || modelConcern !== null;

  const tone = hasConcern
    ? { border: "border-destructive/40", bg: "bg-destructive/5", text: "text-destructive" }
    : conf < 0.5
      ? { border: "border-warning/40", bg: "bg-warning/5", text: "text-warning" }
      : { border: "border-success/40", bg: "bg-success/5", text: "text-success" };
  const Icon = hasConcern ? AlertTriangle : Sparkles;

  const bits: string[] = [];
  if (typeof fields.extracted_year === "number") {
    bits.push(String(fields.extracted_year));
  }
  if (typeof fields.extracted_amount_or_total === "number") {
    bits.push(formatCurrency(fields.extracted_amount_or_total, locale, 0));
  }

  const identifiers = Array.isArray(fields.key_identifiers)
    ? fields.key_identifiers
    : [];
  const amounts = Array.isArray(fields.amounts) ? fields.amounts : [];
  const detailRows: { label: string; value: string }[] = [];
  if (fields.party_name)
    detailRows.push({ label: t("detail_name"), value: fields.party_name });
  if (fields.issuer_name)
    detailRows.push({ label: t("detail_issuer"), value: fields.issuer_name });
  if (typeof fields.extracted_year === "number")
    detailRows.push({ label: t("detail_year"), value: String(fields.extracted_year) });
  if (fields.account_or_period)
    detailRows.push({ label: t("detail_period"), value: fields.account_or_period });
  if (fields.form_identifier)
    detailRows.push({ label: t("detail_form"), value: fields.form_identifier });

  const hasDetails =
    !!fields.reasoning ||
    identifiers.length > 0 ||
    detailRows.length > 0 ||
    amounts.length > 0 ||
    !!fields.second_guess;

  return (
    <div className={`rounded-md border ${tone.border} ${tone.bg} text-xs`}>
      <button
        type="button"
        onClick={() => hasDetails && setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left"
        aria-expanded={hasDetails ? open : undefined}
      >
        {hasDetails ? (
          open ? (
            <ChevronDown className={`size-3 shrink-0 ${tone.text}`} aria-hidden />
          ) : (
            <ChevronRight className={`size-3 shrink-0 ${tone.text}`} aria-hidden />
          )
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        <Icon className={`size-3 shrink-0 ${tone.text}`} aria-hidden />
        <span className={`font-medium uppercase tracking-wide text-[10px] ${tone.text}`}>
          {t("label")}
        </span>
        <span className={`font-medium ${tone.text}`}>
          {hasConcern
            ? t("review_heading")
            : t("likely", { type: detected.toUpperCase() })}
        </span>
        {!hasConcern && bits.length > 0 && (
          <span className="text-muted-foreground truncate">
            — {bits.join(" · ")}
          </span>
        )}
        <span className={`font-mono ${tone.text}/70 ml-auto`}>
          {Math.round(conf * 100)}%
        </span>
      </button>

      {/* Mismatch flags — always visible, they're the actionable part. */}
      {hasConcern && (
        <ul className={`px-2 pb-1.5 space-y-0.5 ${tone.text}/90 leading-snug`}>
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
                    ? t("year_mismatch", { expected: f.expected, actual: f.actual })
                    : t("identity_mismatch", { expected: f.expected, actual: f.actual })}
              </span>
              <span className={`font-mono ${tone.text}/60 shrink-0`}>
                {Math.round(f.confidence * 100)}%
              </span>
            </li>
          ))}
          {modelConcern && <li>{modelConcern}</li>}
        </ul>
      )}

      {/* Rich read — progressive disclosure. */}
      {open && hasDetails && (
        <div className={`border-t ${tone.border} px-3 py-2 space-y-1.5 text-muted-foreground`}>
          {fields.reasoning && (
            <p>
              <span className="font-medium text-foreground/80">{t("detail_why")}:</span>{" "}
              {fields.reasoning}
            </p>
          )}
          {identifiers.length > 0 && (
            <p>
              <span className="font-medium text-foreground/80">{t("detail_read")}:</span>{" "}
              {identifiers.join(", ")}
            </p>
          )}
          {detailRows.length > 0 && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
              {detailRows.map((r) => (
                <Fragment key={r.label}>
                  <dt className="text-muted-foreground/80">{r.label}</dt>
                  <dd className="text-foreground/90">{r.value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {amounts.length > 0 && (
            <div>
              <span className="font-medium text-foreground/80">{t("detail_amounts")}:</span>
              <ul className="mt-0.5 space-y-0.5">
                {amounts.map((a, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate">{a.label}</span>
                    <span className="font-mono shrink-0">
                      {formatCurrency(a.value, locale, 2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fields.second_guess && (
            <p>
              <span className="font-medium text-foreground/80">{t("detail_also_possible")}:</span>{" "}
              {fields.second_guess.document_type.toUpperCase()} (
              {Math.round(fields.second_guess.confidence * 100)}%)
            </p>
          )}
          <p className="text-[11px] italic">{t("advisory")}</p>
        </div>
      )}
    </div>
  );
}
