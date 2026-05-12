"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
} from "lucide-react";
import { AiBadge } from "./ai-badge";
import { reclassifyFileAction } from "@/app/actions/ai";
import { formatBytes } from "@/lib/format";
import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { DocType } from "@/lib/db/templates";

export function FilePreviewRow({
  file,
  url,
  expectedDocType,
}: {
  file: UploadedFile;
  url: string;
  expectedDocType: DocType;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState(false);
  const isImage = file.mime_type.startsWith("image/");
  const isPdf = file.mime_type === "application/pdf";
  const canPreview = isImage || isPdf;

  return (
    <li className="rounded-md border border-border bg-card">
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
        <form action={reclassifyFileAction}>
          <input type="hidden" name="id" value={file.id} />
          <button
            type="submit"
            className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-label={t("reclassify")}
            title={t("reclassify")}
          >
            <RefreshCw className="size-3.5" />
          </button>
        </form>
      </div>
      <div className="px-2.5 pb-1.5">
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
            />
          )}
        </div>
      )}
    </li>
  );
}
