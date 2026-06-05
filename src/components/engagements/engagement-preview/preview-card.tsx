"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useInView } from "./use-in-view";
import { previewHeader, type PreviewDoc, type PreviewStatus } from "./preview-model";

const PreviewPdfThumb = dynamic(() => import("./preview-pdf-thumb"), {
  ssr: false,
});

const STATUS_UI: Record<
  PreviewStatus,
  { border: string; badge: string; text: string; Icon: typeof CheckCircle2 }
> = {
  approved: {
    border: "border-success/60",
    badge: "bg-success",
    text: "text-success",
    Icon: CheckCircle2,
  },
  flagged: {
    border: "border-warning/60",
    badge: "bg-warning",
    text: "text-warning",
    Icon: AlertTriangle,
  },
  rejected: {
    border: "border-destructive/60",
    badge: "bg-destructive",
    text: "text-destructive",
    Icon: XCircle,
  },
  pending: {
    border: "border-border/50",
    badge: "bg-muted-foreground/70",
    text: "text-muted-foreground",
    Icon: Clock,
  },
};

// One document in the grid: a recognisable thumbnail (image rendition or PDF
// first page, lazy-loaded), a couple-word header, an unmistakable colour status
// (border + corner icon + labelled line — never colour alone), and hover/focus
// quick actions (approve, reject, download). Clicking the thumbnail opens the
// detail view (a covering button keeps it keyboard-accessible; the quick actions
// layer above it).
export function PreviewCard({
  doc,
  locale,
  pending,
  onOpen,
  onApprove,
  onReject,
}: {
  doc: PreviewDoc;
  locale: string;
  pending: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const t = useTranslations("Preview");
  const [ref, inView] = useInView<HTMLDivElement>();
  const [imgError, setImgError] = useState(false);
  const [pdfError, setPdfError] = useState(false);

  const header = previewHeader(doc, locale);
  const s = STATUS_UI[doc.status];
  const statusLabel = t(`status_${doc.status}`);
  const isOther = !doc.isImage && !doc.isPdf;
  const fallback =
    isOther || (doc.isImage && imgError) || (doc.isPdf && pdfError);

  return (
    <article
      title={statusLabel}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border-2 bg-card/40 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        s.border,
      )}
    >
      <div
        ref={ref}
        className="relative aspect-[3/4] w-full overflow-hidden bg-muted/30"
      >
        {!inView ? (
          <div className="size-full bg-muted/40 motion-safe:animate-pulse" />
        ) : fallback ? (
          <div className="flex size-full items-center justify-center text-muted-foreground/50">
            <FileText className="size-7" aria-hidden />
          </div>
        ) : doc.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${doc.fileId}/thumb`}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
            className="size-full object-cover object-top"
          />
        ) : (
          <PreviewPdfThumb
            url={`/api/files/${doc.fileId}`}
            onError={() => setPdfError(true)}
          />
        )}

        {/* Open affordance — covers the thumbnail, keyboard-focusable. The
            quick actions + badges sit above it (z-20) so they take their own
            clicks. */}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${t("open")} ${header}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset"
        />

        {/* Status corner badge — the icon is the non-colour cue. */}
        <span
          className={cn(
            "pointer-events-none absolute top-1.5 right-1.5 z-20 inline-flex size-5 items-center justify-center rounded-full text-white shadow-sm",
            s.badge,
          )}
        >
          <s.Icon className="size-3.5" aria-hidden />
          <span className="sr-only">{statusLabel}</span>
        </span>

        {/* How many files share this checklist item (shared approve/reject). */}
        {doc.siblingCount > 1 && (
          <span className="pointer-events-none absolute top-1.5 left-1.5 z-20 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {t("n_files", { count: doc.siblingCount })}
          </span>
        )}

        {/* In-flight approve/reject (visual only; the card stays clickable). */}
        {pending && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/40">
            <Loader2 className="size-5 animate-spin text-foreground/70" />
          </div>
        )}

        {/* Quick actions — hidden until hover/keyboard focus, and not clickable
            while hidden (pointer-events gated with opacity). */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/50 to-transparent p-1.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <QuickButton
            label={t("approve")}
            onClick={onApprove}
            disabled={pending}
            className="hover:text-success"
          >
            <Check className="size-4" aria-hidden />
          </QuickButton>
          <QuickButton
            label={t("reject")}
            onClick={onReject}
            disabled={pending}
            className="hover:text-destructive"
          >
            <X className="size-4" aria-hidden />
          </QuickButton>
          <a
            href={`/api/files/${doc.fileId}?download=1`}
            download
            aria-label={t("download")}
            title={t("download")}
            className="inline-flex size-7 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-primary"
          >
            <Download className="size-4" aria-hidden />
          </a>
        </div>
      </div>

      {/* Couple-word header + labelled status line (icon + text, not colour
          alone). */}
      <div className="min-w-0 px-2 py-1.5">
        <div
          className="truncate text-xs font-medium text-foreground"
          title={header}
        >
          {header}
        </div>
        <div className={cn("mt-0.5 flex items-center gap-1 text-[11px]", s.text)}>
          <s.Icon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{statusLabel}</span>
        </div>
      </div>
    </article>
  );
}

function QuickButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex size-7 cursor-pointer items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
