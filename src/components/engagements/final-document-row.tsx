"use client";

import { useTranslations } from "next-intl";
import { Download, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteFinalDocumentAction } from "@/app/actions/final-documents";

// One row in the accountant's Final documents tab: the deliverable's name, a
// download link (pre-signed server-side), and a delete control. The download link
// here is the accountant's own short-lived signed URL (always allowed — the
// invoice lock only ever gates the CLIENT's portal download, never the firm).
export function FinalDocumentRow({
  id,
  engagementId,
  filename,
  note,
  downloadHref,
  canEdit,
}: {
  id: string;
  engagementId: string;
  filename: string;
  note: string | null;
  // Null if signing the URL failed; the download link is then disabled.
  downloadHref: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations("Engagements");
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-3.5 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{filename}</div>
          {note && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {note}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {downloadHref ? (
          <a
            href={downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Download className="size-3.5" aria-hidden />
            {t("final_download")}
          </a>
        ) : null}
        {canEdit ? (
          <form action={deleteFinalDocumentAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="engagement_id" value={engagementId} />
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              aria-label={t("final_delete")}
            >
              <Trash2 className="size-4 text-muted-foreground" aria-hidden />
            </Button>
          </form>
        ) : null}
      </div>
    </li>
  );
}
