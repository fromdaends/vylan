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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addSignatureItemAction } from "@/app/actions/signatures";
import type { ItemActionState } from "@/app/actions/items";
import { PenLine, Upload } from "lucide-react";

export function AddSignatureDialog({ engagementId }: { engagementId: string }) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [state, action, pending] = useActionState<ItemActionState, FormData>(
    addSignatureItemAction,
    null,
  );

  useEffect(() => {
    if (!state?.ok) return;
    queueMicrotask(() => {
      setOpen(false);
      setFileName(null);
      router.refresh();
    });
  }, [state, router]);

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
          <PenLine className="size-4" />
          {t("request_signature")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("request_signature_title")}</DialogTitle>
          <DialogDescription>
            {t("request_signature_subtitle")}
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-3">
          <input type="hidden" name="engagement_id" value={engagementId} />
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {t(state.error === "file" ? "sig_err_file" : "sig_err_generic")}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sig_label_fr">{t("label_fr_placeholder")}</Label>
              <Input
                id="sig_label_fr"
                name="label_fr"
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sig_label_en">{t("label_en_placeholder")}</Label>
              <Input
                id="sig_label_en"
                name="label_en"
                required
                maxLength={200}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sig_file">{t("signing_document")}</Label>
            <input
              ref={fileRef}
              id="sig_file"
              type="file"
              name="file"
              required
              accept="application/pdf,image/*"
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
                {fileName ?? t("choose_document")}
              </span>
            </Button>
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
              {pending ? tc("saving") : t("request_signature")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
