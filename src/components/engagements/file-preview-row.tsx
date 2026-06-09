"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import { AiBadge } from "./ai-badge";
import { UsabilityBadge } from "./usability-badge";
import { reclassifyFileAction } from "@/app/actions/ai";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";

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

// How long the "Re-checking…" animation runs if the verdict comes back
// unchanged (a re-run that confirms the same result produces no signature
// change to react to, so we stop after a grace period). When the verdict DOES
// change, the page's auto-refresh brings it sooner and we stop immediately.
const RECHECK_TIMEOUT_MS = 12_000;

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
  // (the badges + the re-check button) — otherwise the badges would sit in a
  // permanent "Analyzing…" state waiting for a verdict that never comes.
  hideAi?: boolean;
  // Extra controls rendered at the end of the header row (e.g. the per-copy
  // approve/reject icons for a returned signed copy).
  actions?: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isImage = file.mime_type.startsWith("image/");
  const isPdf = file.mime_type === "application/pdf";
  const canPreview = isImage || isPdf;

  // Bytes are served by the authenticated, same-origin proxy keyed by file id.
  // inline = view / open-in-new-tab; ?download=1 = force-download with the
  // original filename.
  const source = useMemo(
    () => ({
      url: `/api/files/${file.id}`,
      openHref: `/api/files/${file.id}`,
      downloadUrl: `/api/files/${file.id}?download=1`,
      filename: file.original_filename,
      isImage,
    }),
    [file.id, file.original_filename, isImage],
  );

  // A fingerprint of the AI verdict. It changes when a fresh classification
  // lands (the engagement page auto-refreshes while live), which is our cue to
  // stop the animation — so the spinner tracks the real result, not a timer.
  const sig = `${file.ai_classification}|${file.ai_confidence}|${file.ai_rejected}|${JSON.stringify(file.ai_usability)}`;
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) {
    // Documented React pattern: adjust state during render when a prop changes
    // (guarded by prevSig so it can't loop). Verdict refreshed → stop spinning.
    setPrevSig(sig);
    if (rechecking) setRechecking(false);
  }

  function recheck() {
    if (rechecking) return;
    setRechecking(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setRechecking(false), RECHECK_TIMEOUT_MS);
    const fd = new FormData();
    fd.append("id", file.id);
    startTransition(async () => {
      try {
        await reclassifyFileAction(fd);
      } catch (e) {
        console.error("[reclassify] failed:", e);
        // The verdict won't change; let the timeout clear the animation.
      }
    });
  }

  return (
    <li className="rounded-md border border-border/40 bg-card/40">
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
        <span className="truncate flex-1 font-medium">
          {file.original_filename}
        </span>
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
          download={file.original_filename}
          className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={t("download_file")}
          title={t("download_file")}
        >
          <Download className="size-3.5" />
        </a>
        {!hideAi && (
          <button
            type="button"
            onClick={recheck}
            disabled={rechecking}
            className={cn(
              "rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
              rechecking
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label={t("reclassify")}
            title={t("reclassify")}
          >
            <RefreshCw className={cn("size-3.5", rechecking && "animate-spin")} />
          </button>
        )}
        {actions}
      </div>
      {!hideAi && (
        <div className="px-2.5 pb-1.5 space-y-1">
          {/* While re-checking, an explicit pill makes it obvious the AI is
              running again (the verdict badges keep their previous value until a
              fresh result lands). */}
          {rechecking && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
              aria-live="polite"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t("rechecking")}
            </span>
          )}
          {/* Usability lives above the document-type badge — separate
              concerns: "is this readable?" vs "is this the right slip?"
              UsabilityBadge renders null when there's no actionable
              verdict so well-readable files don't get extra chrome. */}
          <UsabilityBadge
            fileId={file.id}
            verdict={file.ai_usability}
            aiRejected={file.ai_rejected}
            rejectionCount={rejectionCount}
          />
          <AiBadge
            file={file}
            expectedDocType={expectedDocType}
            expectedYear={expectedYear}
            clientName={clientName}
            quiet={Boolean(file.ai_usability && !file.ai_usability.usable)}
          />
        </div>
      )}
      {open && canPreview && (
        <div className="border-t border-border p-2 bg-muted/30">
          {isImage ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={source.url}
                alt={file.original_filename}
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
