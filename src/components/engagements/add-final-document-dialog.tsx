"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  uploadFinalDocumentAction,
  type FinalDocumentActionState,
} from "@/app/actions/final-documents";
import { Upload, FileUp } from "lucide-react";

// Accountant control to upload a completed deliverable (final document) to return
// to the client. Mirrors AddSignatureDialog: a small dialog with a single file
// picker that posts to the server action.
export function AddFinalDocumentDialog({
  engagementId,
}: {
  engagementId: string;
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [state, action, pending] = useActionState<
    FinalDocumentActionState,
    FormData
  >(uploadFinalDocumentAction, null);

  useEffect(() => {
    if (!state?.ok) return;
    queueMicrotask(() => {
      setOpen(false);
      setFileName(null);
      router.refresh();
    });
  }, [state, router]);

  const errorKey =
    state?.error === "file_too_large"
      ? "final_err_file_too_large"
      : state?.error === "file"
        ? "final_err_file"
      : state?.error === "file_type"
          ? "final_err_file_type"
          : state?.error === "note_too_long"
            ? "final_err_note_too_long"
          : "final_err_generic";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFileName(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileUp className="size-4" />
          {t("final_upload")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("final_upload_title")}</DialogTitle>
          <DialogDescription>{t("final_upload_subtitle")}</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-3">
          <input type="hidden" name="engagement_id" value={engagementId} />
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="final_file">{t("final_document")}</Label>
            <input
              ref={fileRef}
              id="final_file"
              type="file"
              name="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start font-normal"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4 shrink-0" />
              <span className="truncate">
                {fileName ?? t("final_choose_document")}
              </span>
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="final_note">{t("final_note")}</Label>
            <Textarea
              id="final_note"
              name="note"
              rows={3}
              maxLength={1000}
              placeholder={t("final_note_placeholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("final_note_hint")}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : t("final_upload")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
