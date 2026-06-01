"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { AiBadge } from "./ai-badge";
import { UsabilityBadge } from "./usability-badge";
import { reclassifyFileAction } from "@/app/actions/ai";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";

// How long the "Re-checking…" animation runs if the verdict comes back
// unchanged (a re-run that confirms the same result produces no signature
// change to react to, so we stop after a grace period). When the verdict DOES
// change, the page's auto-refresh brings it sooner and we stop immediately.
const RECHECK_TIMEOUT_MS = 12_000;

export function FilePreviewRow({
  file,
  url,
  expectedDocType,
  rejectionCount,
}: {
  file: UploadedFile;
  url: string;
  expectedDocType: DocType;
  rejectionCount: number;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isImage = file.mime_type.startsWith("image/");
  const isPdf = file.mime_type === "application/pdf";
  const canPreview = isImage || isPdf;

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
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={t("open_new_tab")}
          title={t("open_new_tab")}
        >
          <ExternalLink className="size-3.5" />
        </a>
        <a
          href={url}
          download={file.original_filename}
          className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={t("download_file")}
          title={t("download_file")}
        >
          <Download className="size-3.5" />
        </a>
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
      </div>
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
        <AiBadge file={file} expectedDocType={expectedDocType} />
      </div>
      {open && canPreview && (
        <div className="border-t border-border p-2 bg-muted/30">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={file.original_filename}
              className="max-h-[480px] w-auto mx-auto rounded"
            />
          ) : (
            <iframe
              src={url}
              title={file.original_filename}
              className="w-full h-[520px] rounded bg-white"
              sandbox=""
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      )}
    </li>
  );
}
