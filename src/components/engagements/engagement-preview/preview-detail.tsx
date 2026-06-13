"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Sparkles,
  Trash2,
  X,
  XCircle,
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
import { deleteFileAction } from "@/app/actions/files";
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
  belongs_to_client?: boolean | null;
  belongs_confidence?: number | null;
  overall_confidence?: number | null;
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
  position,
  onPrev,
  onNext,
  onApprove,
  onReject,
  onBack,
  onCloseOverlay,
  onDeleted,
}: {
  doc: PreviewDoc;
  file: UploadedFile;
  expectedDocType: DocType;
  expectedYear: number | null;
  clientName: string | null;
  locale: AppLocale;
  pending: boolean;
  // The open document's place in the grid order ({index 0-based, total}), or
  // null when it's not in the current filtered set. Drives the "n / total"
  // counter shown between the arrows.
  position: { index: number; total: number } | null;
  // Step to the previous / next document in grid order. Null at the ends (the
  // arrow renders disabled — navigation stops, it doesn't wrap).
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onApprove: () => void;
  onReject: () => void;
  onBack: () => void;
  onCloseOverlay: () => void;
  // Called after a successful PERMANENT delete; the overlay drops the doc
  // from its grid and closes this detail panel.
  onDeleted: (fileId: string) => void;
}) {
  const t = useTranslations("Preview");
  const tEng = useTranslations("Engagements");
  const tAi = useTranslations("Ai");
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      const fd = new FormData();
      fd.append("id", file.id);
      const res = await deleteFileAction(fd);
      if (!res?.ok) throw new Error(res?.error ?? "delete_failed");
      setConfirmDeleteOpen(false);
      onDeleted(file.id);
    } catch (e) {
      console.error("[file delete] failed:", e);
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  // Move focus into the detail when it opens, so keyboard users land on the
  // document's actions rather than behind the panel.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Left / right arrow keys step between documents (the on-screen arrows' twin).
  // Guarded so it can't fire while a blocking layer owns the keyboard: the
  // delete-confirm dialog (its own state), the reject prompt (which makes this
  // whole panel `inert` — we walk up to detect it), or a typed field. prevents
  // the default so the document viewer doesn't also scroll on the keypress.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (confirmDeleteOpen || deleting) return;
      if (rootRef.current?.closest("[inert]")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) {
        return;
      }
      const handler = e.key === "ArrowLeft" ? onPrev : onNext;
      if (!handler) return;
      e.preventDefault();
      handler();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmDeleteOpen, deleting, onPrev, onNext]);

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

  // The headline score the accountant sees: the AI's honest "is this the right +
  // usable document" judgment (overall_confidence), NOT the raw type confidence.
  // Falls back to type confidence for files analysed before the model returned
  // it. Colour-graded so a wrong-person / wrong-year doc reads low at a glance.
  const overall =
    typeof fields.overall_confidence === "number"
      ? fields.overall_confidence
      : conf;
  const scoreText =
    overall == null
      ? "text-muted-foreground"
      : overall >= 0.8
        ? "text-success"
        : overall >= 0.5
          ? "text-warning"
          : "text-destructive";
  const scoreBar =
    overall == null
      ? "bg-muted-foreground/40"
      : overall >= 0.8
        ? "bg-success"
        : overall >= 0.5
          ? "bg-warning"
          : "bg-destructive";

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
            belongs_to_client:
              typeof fields.belongs_to_client === "boolean"
                ? fields.belongs_to_client
                : null,
            belongs_confidence:
              typeof fields.belongs_confidence === "number"
                ? fields.belongs_confidence
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

          {/* Step through the documents in the grid, in on-screen order.
              Disabled (not hidden) at the ends so the control's position is
              stable; the counter says where you are. Mirrored by the ← / →
              keys. Hidden only when the open doc isn't in the current set. */}
          {position && (
            <div
              className="flex shrink-0 items-center gap-0.5 border-l border-border/40 pl-2"
              role="group"
              aria-label={t("doc_position", {
                index: position.index + 1,
                total: position.total,
              })}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!onPrev}
                onClick={() => onPrev?.()}
                aria-label={t("prev_doc")}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-[3.5ch] text-center text-xs tabular-nums text-muted-foreground">
                {position.index + 1}/{position.total}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!onNext}
                onClick={() => onNext?.()}
                aria-label={t("next_doc")}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}

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
          {/* Permanent delete — erases the document outright (storage + DB),
              which also removes it from the client portal. Confirmed below. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pending || deleting}
            aria-label={tEng("file_delete")}
            title={tEng("file_delete")}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              setDeleteFailed(false);
              setConfirmDeleteOpen(true);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
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

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="z-[60] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tEng("file_delete_confirm_title")}</DialogTitle>
            <DialogDescription>
              {tEng("file_delete_confirm_body", {
                name: file.display_name ?? file.original_filename,
              })}
            </DialogDescription>
          </DialogHeader>
          {deleteFailed && (
            <p className="text-sm text-destructive">
              {tEng("file_delete_failed")}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleting}
            >
              {tEng("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {tEng("file_delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {typeName}
                </div>
              ) : (
                <div className="mt-1 text-sm text-muted-foreground">
                  {t("status_pending")}
                </div>
              )}
            </section>

            {/* Prominent headline score — the AI's honest "is this the right +
                usable document" judgment, not the raw type confidence. A
                wrong-person or wrong-year document reads LOW here at a glance. */}
            {overall != null && (
              <section className="rounded-lg border border-border/50 bg-card/40 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("match_score")}
                  </span>
                  <span
                    className={cn(
                      "text-3xl leading-none font-bold tabular-nums",
                      scoreText,
                    )}
                  >
                    {Math.round(overall * 100)}
                    <span className="text-lg font-semibold">%</span>
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", scoreBar)}
                    style={{ width: `${Math.max(4, Math.round(overall * 100))}%` }}
                  />
                </div>
              </section>
            )}

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
