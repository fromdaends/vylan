"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Download, FileText, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteFinalDocumentAction } from "@/app/actions/final-documents";
import { getFiledCopyInfoAction } from "@/app/actions/files";

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
          <FinalDocumentDelete
            id={id}
            engagementId={engagementId}
            filename={filename}
          />
        ) : null}
      </div>
    </li>
  );
}

// Delete with confirmation. When Vylan FILED this deliverable to the firm's
// storage (finals opt-in), the dialog also offers moving that copy to the
// provider's trash — explicit, per delete, default OFF (founder decision
// 2026-07-27). Replaces the old bare submit button, which deleted on a single
// misclick with no confirm at all.
// Exported for the floating task panel (design 2a): its deliverable rows are
// drawn to the panel's spec but share THIS delete flow — confirmation plus the
// filed-copy offer — rather than growing a second one.
export function FinalDocumentDelete({
  id,
  engagementId,
  filename,
}: {
  id: string;
  engagementId: string;
  filename: string;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filedProvider, setFiledProvider] = useState<
    "google_drive" | "microsoft" | "dropbox" | null
  >(null);
  const [removeCopy, setRemoveCopy] = useState(false);
  const [pending, startTransition] = useTransition();

  function onOpenChange(v: boolean) {
    setOpen(v);
    if (v) {
      setRemoveCopy(false);
      setFiledProvider(null);
      void getFiledCopyInfoAction("final", id).then((info) => {
        if (info.filed) setFiledProvider(info.provider);
      });
    }
  }

  function confirm() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", id);
      fd.append("engagement_id", engagementId);
      if (removeCopy && filedProvider) fd.append("remove_filed_copy", "1");
      await deleteFinalDocumentAction(fd);
      setOpen(false);
      router.refresh();
    });
  }

  const providerName =
    filedProvider === "google_drive"
      ? "Google Drive"
      : filedProvider === "microsoft"
        ? "SharePoint / OneDrive"
        : "Dropbox";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("final_delete")}
        onClick={() => onOpenChange(true)}
      >
        <Trash2 className="size-4 text-muted-foreground" aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("final_delete_confirm_title")}</DialogTitle>
            <DialogDescription>
              {t("final_delete_confirm_body", { name: filename })}
            </DialogDescription>
          </DialogHeader>
          {filedProvider && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t("file_delete_storage_label", { provider: providerName })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("file_delete_storage_hint")}
                </p>
              </div>
              <Switch
                checked={removeCopy}
                onCheckedChange={setRemoveCopy}
                aria-label={t("file_delete_storage_label", {
                  provider: providerName,
                })}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirm}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("final_delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
