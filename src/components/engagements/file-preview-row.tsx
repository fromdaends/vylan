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
  MessageSquare,
  MoreVertical,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { commentKeyForFile } from "@/components/engagements/comment-thread";
import { useCommentFromMenu } from "@/components/engagements/use-comment-from-menu";
import { toast } from "sonner";
import {
  deleteFileAction,
  getFiledCopyInfoAction,
} from "@/app/actions/files";
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
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RejectModal } from "@/components/engagements/reject-modal";

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
    // A passing document keeps a plain neutral outline (no green box) — the
    // colored "Looks right" text + dot still carry the status. Amber/red tones
    // below stay tinted so documents that NEED attention still stand out.
    row: "border-border/40 bg-card/40",
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
  reviewAction,
  commentable,
  commentAnchor,
  footer,
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
  // Optional accountant review action. It lives in both the kebab and
  // right-click menus rather than consuming permanent row space.
  reviewAction?:
    | { kind: "reject"; itemId: string; itemLabel: string; fileId: string }
    | { kind: "reopen"; fileId: string };
  // Team mode: right-click / the kebab offer "Add a comment", which opens the
  // card hanging off `commentAnchor`.
  commentable?: boolean;
  // This file's CommentThread bubble, rendered in the row's right-hand
  // controls. A ReactNode (not a function) so the server page can build it and
  // hand it across the client boundary.
  commentAnchor?: ReactNode;
  // Optional content rendered at the bottom of the row, inside the same <li>
  // (e.g. the QuickBooks draft card). Kept inside the li so the list markup
  // stays valid and the content reads as belonging to this file.
  footer?: ReactNode;
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
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [, startTransition] = useTransition();
  // Both this row's menus open the comment card only once the menu has closed
  // (see useCommentFromMenu — opening from onSelect lets the menu's focus
  // restore dismiss the card the moment it appears).
  const comment = useCommentFromMenu();

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

  // Filed-copy state for the delete dialog (founder decision 2026-07-27):
  // when Vylan filed this document to the firm's storage, deleting may ALSO
  // move that copy to the provider's trash — explicitly, per delete, default
  // off. null = still loading / not filed.
  const [filedProvider, setFiledProvider] = useState<
    "google_drive" | "microsoft" | "dropbox" | null
  >(null);
  const [removeCopy, setRemoveCopy] = useState(false);

  function openDeleteDialog(open: boolean) {
    setConfirmDeleteOpen(open);
    if (open) {
      setRemoveCopy(false);
      setFiledProvider(null);
      void getFiledCopyInfoAction("checklist", file.id).then((info) => {
        if (info.filed) setFiledProvider(info.provider);
      });
    }
  }

  function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    const fd = new FormData();
    fd.append("id", file.id);
    if (removeCopy && filedProvider) fd.append("remove_filed_copy", "1");
    startTransition(async () => {
      try {
        const res = await deleteFileAction(fd);
        if (!res?.ok) throw new Error(res?.error ?? "delete_failed");
        if (res.storageCopy === "failed") {
          toast.error(t("file_delete_storage_failed"));
        }
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

  async function reopenFile() {
    if (reviewAction?.kind !== "reopen" || reopening) return;
    setReopening(true);
    try {
      const response = await fetch(`/api/files/${reviewAction.fileId}/reopen`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      if (result?.ok) router.refresh();
      else toast.error(t("reopen_error"));
    } catch {
      toast.error(t("reopen_error"));
    } finally {
      setReopening(false);
    }
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
  // "Escalated" is the one status whose MEANING depends on a number: the
  // client has already been asked the maximum number of times, which is why it
  // landed on the accountant instead of going back to them. Saying only "Needs
  // review" hid that, so the accountant had no way to know the client had been
  // chased 5 times and would not be chased again.
  const aiStatusLabel = showAi
    ? aiView!.headline.kind === "escalated"
      ? tAi("status_escalated", { count: rejectionCount })
      : tAi(`status_${aiView!.headline.kind}`)
    : "";
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
        {/* This document's comment bubble (Notion): silent until the file has
            a comment, then it sits just left of the kebab. */}
        {commentAnchor}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none"
              aria-label={t("more_actions")}
              title={t("more_actions")}
            >
              <MoreVertical className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44 !animate-none"
            onCloseAutoFocus={comment.onCloseAutoFocus}
          >
            <DropdownMenuItem asChild>
              <a href={source.openHref} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                {t("open_new_tab")}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={source.downloadUrl} download={displayName}>
                <Download />
                {t("download_file")}
              </a>
            </DropdownMenuItem>
            {reviewAction?.kind === "reject" && (
              <DropdownMenuItem onSelect={() => setRejectOpen(true)}>
                <TriangleAlert />
                {t("reject")}
              </DropdownMenuItem>
            )}
            {reviewAction?.kind === "reopen" && (
              <DropdownMenuItem disabled={reopening} onSelect={reopenFile}>
                <RotateCcw className={cn(reopening && "animate-spin")} />
                {t("file_undo_reject")}
              </DropdownMenuItem>
            )}
            {commentable && (
              <DropdownMenuItem
                onSelect={() => comment.request(commentKeyForFile(file.id))}
              >
                <MessageSquare />
                {t("add_comment")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                setDeleteFailed(false);
                setConfirmDeleteOpen(true);
              }}
            >
              <Trash2 />
              {t("file_delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {reviewAction?.kind === "reject" && (
        <RejectModal
          itemId={reviewAction.itemId}
          itemLabel={reviewAction.itemLabel}
          fileId={reviewAction.fileId}
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          hideTrigger
        />
      )}
      <Dialog open={confirmDeleteOpen} onOpenChange={openDeleteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("file_delete_confirm_title")}</DialogTitle>
            <DialogDescription>
              {t("file_delete_confirm_body", { name: displayName })}
            </DialogDescription>
          </DialogHeader>
          {/* Vylan filed this document to the firm's storage — offer to move
              that copy to the provider's trash too. Default OFF. */}
          {filedProvider && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t("file_delete_storage_label", {
                    provider:
                      filedProvider === "google_drive"
                        ? "Google Drive"
                        : filedProvider === "microsoft"
                          ? "SharePoint / OneDrive"
                          : "Dropbox",
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("file_delete_storage_hint")}
                </p>
              </div>
              <Switch
                checked={removeCopy}
                onCheckedChange={setRemoveCopy}
                aria-label={t("file_delete_storage_label", {
                  provider:
                    filedProvider === "google_drive"
                      ? "Google Drive"
                      : "SharePoint / OneDrive",
                })}
              />
            </div>
          )}
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
      {footer && <div className="px-2.5 pb-2">{footer}</div>}
      {viewerOpen && (
        <DocumentViewerModal
          source={source}
          onClose={() => setViewerOpen(false)}
        />
      )}
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-44 !animate-none"
        onCloseAutoFocus={comment.onCloseAutoFocus}
      >
        <ContextMenuItem asChild>
          <a href={source.openHref} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            {t("open_new_tab")}
          </a>
        </ContextMenuItem>
        <ContextMenuItem asChild>
          <a href={source.downloadUrl} download={displayName}>
            <Download />
            {t("download_file")}
          </a>
        </ContextMenuItem>
        {reviewAction?.kind === "reject" && (
          <ContextMenuItem onSelect={() => setRejectOpen(true)}>
            <TriangleAlert />
            {t("reject")}
          </ContextMenuItem>
        )}
        {reviewAction?.kind === "reopen" && (
          <ContextMenuItem disabled={reopening} onSelect={reopenFile}>
            <RotateCcw className={cn(reopening && "animate-spin")} />
            {t("file_undo_reject")}
          </ContextMenuItem>
        )}
        {commentable && (
          <ContextMenuItem
            onSelect={() => comment.request(commentKeyForFile(file.id))}
          >
            <MessageSquare />
            {t("add_comment")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            setDeleteFailed(false);
            setConfirmDeleteOpen(true);
          }}
        >
          <Trash2 />
          {t("file_delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
