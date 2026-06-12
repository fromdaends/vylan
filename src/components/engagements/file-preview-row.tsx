"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { deleteFileAction } from "@/app/actions/files";
import { formatBytes, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  deriveFileAi,
  type AiHeadlineKind,
  type AiHeadlineTone,
} from "@/lib/engagements/file-ai-headline";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The document viewer pulls in react-pdf / pdf.js — browser-only and a sizeable
// chunk — so load it lazily (ssr:false). It ships only when an accountant
// actually opens a preview; the row itself stays light, and pdf.js never runs
// on the server (it throws on Node).
const DocumentViewerModal = dynamic(
  () => import("./document-viewer").then((m) => m.DocumentViewerModal),
  { ssr: false },
);
const InlinePdfPreview = dynamic(
  () => import("./document-viewer").then((m) => m.InlinePdfPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

// The AI verdict now tints the WHOLE file row (border + faint fill) instead of
// sitting in a separate box below it — so the status reads as part of the
// document, not an afterthought. Soft tints keep a long checklist calm.
const TONE: Record<
  AiHeadlineTone,
  { row: string; text: string; dot: string }
> = {
  good: {
    row: "border-success/30 bg-success/[0.04]",
    text: "text-success",
    dot: "bg-success",
  },
  warn: {
    row: "border-warning/30 bg-warning/[0.05]",
    text: "text-warning",
    dot: "bg-warning",
  },
  bad: {
    row: "border-destructive/30 bg-destructive/[0.05]",
    text: "text-destructive",
    dot: "bg-destructive",
  },
  neutral: {
    row: "border-border/40 bg-card/40",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};
const NEUTRAL_ROW = "border-border/40 bg-card/40";

// Returns the verdict icon as static JSX (no component-in-render) so each arm
// is a plain element the linter is happy with.
function AiStatusIcon({
  kind,
  className,
}: {
  kind: AiHeadlineKind;
  className?: string;
}) {
  switch (kind) {
    case "looks_right":
      return <CheckCircle2 className={className} aria-hidden />;
    case "analyzing":
      return <Loader2 className={cn(className, "animate-spin")} aria-hidden />;
    case "not_analyzed":
      return <CircleHelp className={className} aria-hidden />;
    case "wrong_type":
    case "auto_rejected":
    case "escalated":
    case "flagged":
      return <TriangleAlert className={className} aria-hidden />;
    default:
      return <Sparkles className={className} aria-hidden />;
  }
}

export function FilePreviewRow({
  file,
  expectedDocType,
  expectedYear,
  clientName,
  rejectionCount,
  hideAi = false,
  actions,
}: {
  file: UploadedFile;
  // Legacy signed-URL prop (still passed by the engagement page). It's
  // superseded by the same-origin /api/files/[id] proxy below — which doesn't
  // expire mid-review and serves HTTP range requests for fast large-file
  // rendering — so we accept it for compatibility but no longer read it.
  url?: string;
  expectedDocType: DocType;
  // Phase 4 matching context (optional — the comparison runs only when known).
  expectedYear?: number | null;
  clientName?: string | null;
  rejectionCount: number;
  // Signature signed-copies are NOT AI-classified (they aren't tax documents),
  // so they never get a usability/type verdict. Set this to hide all AI chrome
  // (the badges) — otherwise the badges would sit in a
  // permanent "Analyzing…" state waiting for a verdict that never comes.
  hideAi?: boolean;
  // Extra controls rendered at the end of the header row (e.g. the per-copy
  // approve/reject icons for a returned signed copy).
  actions?: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const tAi = useTranslations("Ai");
  const locale = useLocale() as AppLocale;
  // Snapshot "now" once for the staleness check (a pure render can't call
  // Date.now() repeatedly without churn; mount precision is plenty).
  const [nowMs] = useState(() => Date.now());
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Permanent per-file delete: confirm dialog + in-flight/error state.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [, startTransition] = useTransition();

  const isImage = file.mime_type.startsWith("image/");
  const isPdf = file.mime_type === "application/pdf";
  const canPreview = isImage || isPdf;

  // The name we show + download as: the AI's clean auto-name when it has one,
  // else the name the client uploaded. (Kept inline — uploaded-files.ts pulls
  // in server-only code, so a client component can't import a helper from it.)
  const displayName = file.display_name ?? file.original_filename;

  // Bytes are served by the authenticated, same-origin proxy keyed by file id.
  // inline = view / open-in-new-tab; ?download=1 = force-download. The route
  // sets the download filename from display_name too, so this `download` attr
  // and the server agree.
  const source = useMemo(
    () => ({
      url: `/api/files/${file.id}`,
      openHref: `/api/files/${file.id}`,
      downloadUrl: `/api/files/${file.id}?download=1`,
      filename: displayName,
      isImage,
    }),
    [file.id, displayName, isImage],
  );

  function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    const fd = new FormData();
    fd.append("id", file.id);
    startTransition(async () => {
      try {
        const res = await deleteFileAction(fd);
        if (!res?.ok) throw new Error(res?.error ?? "delete_failed");
        setConfirmDeleteOpen(false);
        // The action revalidated the page; refresh drops this row from the
        // server-rendered list (and the portal stops serving the file too).
        router.refresh();
      } catch (e) {
        console.error("[file delete] failed:", e);
        setDeleteFailed(true);
      } finally {
        setDeleting(false);
      }
    });
  }

  // The AI verdict, folded into the row itself (tone + a compact status chip in
  // the header, plus a one-line reason when there's a problem). Signature
  // copies (hideAi) and duplicates get no AI chrome.
  const aiView =
    hideAi || file.is_duplicate
      ? null
      : deriveFileAi(
          file,
          {
            expectedDocType,
            expectedYear: expectedYear ?? null,
            clientName: clientName ?? null,
            rejectionCount,
          },
          nowMs,
        );
  const showAi = !!aiView?.show;
  const tone = showAi ? TONE[aiView!.headline.tone] : null;

  // Short detail next to the status word: type · year for good reads; the
  // mismatch / "not a <type>" / model note for type problems; the localized
  // usability summary for usability problems.
  const aiDetail = (() => {
    if (!aiView || !showAi) return "";
    const typeUpper = aiView.detected ? aiView.detected.toUpperCase() : "";
    const yr = aiView.year != null ? String(aiView.year) : null;
    switch (aiView.headline.kind) {
      case "looks_right":
      case "low_confidence":
        return [typeUpper, yr].filter(Boolean).join(" · ");
      case "wrong_type":
        if (aiView.isUnknown)
          return tAi("not_a_document", { expected: expectedDocType.toUpperCase() });
        if (aiView.mismatch?.kind === "type_mismatch")
          return tAi("mismatch", {
            expected: aiView.mismatch.expected.toUpperCase(),
            detected: aiView.mismatch.actual.toUpperCase(),
          });
        // Wrong person — the name read off the document isn't the client's.
        if (aiView.mismatch?.kind === "identity_mismatch")
          return tAi("identity_mismatch", {
            expected: aiView.mismatch.expected,
            actual: aiView.mismatch.actual,
          });
        // Right type + person, wrong tax year.
        if (aiView.mismatch?.kind === "year_mismatch")
          return tAi("year_mismatch", {
            expected: aiView.mismatch.expected,
            actual: aiView.mismatch.actual,
          });
        return aiView.modelConcern ?? "";
      case "auto_rejected":
      case "escalated":
      case "flagged":
        return locale === "fr"
          ? aiView.summaryFr || aiView.summaryEn
          : aiView.summaryEn || aiView.summaryFr;
      default:
        return "";
    }
  })();
  const aiStatusLabel = showAi ? tAi(`status_${aiView!.headline.kind}`) : "";
  const aiKind = aiView?.headline.kind;
  // Clean reads keep their "type · year" inline in the chip. Anything that
  // needs the accountant's eye (wrong document, or a usability problem) puts the
  // reason on its own calm line inside the tinted row — the deep read + override
  // still live on the Preview page.
  const isProblemRow =
    aiKind === "wrong_type" ||
    aiKind === "auto_rejected" ||
    aiKind === "escalated" ||
    aiKind === "flagged";
  const chipDetail = showAi && !isProblemRow ? aiDetail : "";
  const showReasonLine = showAi && isProblemRow && !!aiDetail;

  return (
    <li
      className={cn(
        "rounded-md border transition-colors",
        tone ? tone.row : NEUTRAL_ROW,
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
        {canPreview ? (
          <button
            type="button"
            onClick={() => setOpen((p) => !p)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-expanded={open}
            aria-label={open ? t("collapse_preview") : t("expand_preview")}
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="w-[14px]" aria-hidden />
        )}
        <FileText className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium" title={displayName}>
          {displayName}
        </span>
        {showAi && tone && aiKind && (
          <span
            className={cn(
              "inline-flex max-w-[45%] shrink-0 items-center gap-1 font-medium",
              tone.text,
            )}
          >
            <AiStatusIcon kind={aiKind} className="size-3.5 shrink-0" />
            <span className="shrink-0">{aiStatusLabel}</span>
            {chipDetail && (
              <span className="truncate font-normal text-muted-foreground">
                · {chipDetail}
              </span>
            )}
            {aiKind === "auto_rejected" && (
              <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                {tAi("client_notified")}
              </span>
            )}
            {aiView!.analyzed && (
              <span className="shrink-0 font-mono text-sm font-bold tabular-nums">
                {Math.round(aiView!.overallConfidence * 100)}%
              </span>
            )}
          </span>
        )}
        <span className="font-mono text-muted-foreground shrink-0">
          {formatBytes(file.size_bytes)}
        </span>
        <a
          href={source.openHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={t("open_new_tab")}
          title={t("open_new_tab")}
        >
          <ExternalLink className="size-3.5" />
        </a>
        <a
          href={source.downloadUrl}
          download={displayName}
          className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={t("download_file")}
          title={t("download_file")}
        >
          <Download className="size-3.5" />
        </a>
        {actions}
        {/* Permanent delete — last, destructive tone. Confirmed in a dialog;
            the document is erased outright and disappears from the client
            portal (no recycle bin, by design). */}
        <button
          type="button"
          onClick={() => {
            setDeleteFailed(false);
            setConfirmDeleteOpen(true);
          }}
          className="text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={t("file_delete")}
          title={t("file_delete")}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("file_delete_confirm_title")}</DialogTitle>
            <DialogDescription>
              {t("file_delete_confirm_body", { name: displayName })}
            </DialogDescription>
          </DialogHeader>
          {deleteFailed && (
            <p className="text-sm text-destructive">{t("file_delete_failed")}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t("file_delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Detected duplicate (an exact-content re-upload). Always shown, even for
          signature copies (which hide the AI chrome). The file is set aside, so
          it doesn't affect the checklist item's status. */}
      {file.is_duplicate && (
        <div className="px-2.5 pb-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/15 px-2 py-1 text-xs font-medium text-warning">
            <Copy className="size-3.5" aria-hidden />
            {t("duplicate_badge")}
          </span>
        </div>
      )}
      {/* The reason a document needs the accountant's eye reads as a calm line
          INSIDE the tinted row (not a separate box). The deep read + override
          live on the Preview page. */}
      {showReasonLine && tone && (
        <p
          className={cn(
            "border-t px-2.5 py-1.5 text-xs leading-snug",
            tone.row,
            tone.text,
          )}
        >
          {aiDetail}
        </p>
      )}
      {open && canPreview && (
        <div className="border-t border-border p-2 bg-muted/30">
          {isImage ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={source.url}
                alt={displayName}
                className="max-h-[480px] w-auto mx-auto rounded"
              />
              <button
                type="button"
                onClick={() => setViewerOpen(true)}
                aria-label={t("viewer_fullscreen")}
                title={t("viewer_fullscreen")}
                className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md bg-background/80 text-foreground shadow-sm ring-1 ring-border backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Maximize2 className="size-3.5" />
              </button>
            </div>
          ) : (
            <InlinePdfPreview
              source={source}
              onOpenFull={() => setViewerOpen(true)}
            />
          )}
        </div>
      )}
      {viewerOpen && (
        <DocumentViewerModal
          source={source}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </li>
  );
}
