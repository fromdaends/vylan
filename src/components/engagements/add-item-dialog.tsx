"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addItemAction } from "@/app/actions/items";
import { Loader2, Plus } from "lucide-react";
import { DocTypePicker } from "@/components/engagements/doc-type-picker";
import type { DocType } from "@/lib/db/templates";

export function AddItemDialog({
  engagementId,
  province,
}: {
  engagementId: string;
  // The engagement's client province — limits the doc-type picker to the
  // documents that apply there (no Quebec slips for an Ontario client).
  province?: string | null;
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Controlled inputs. The previous version submitted via the native form +
  // HTML `required`, but in Safari the doc-type picker / dialog could fire the
  // submit before the labels were captured — so the action ran with empty
  // labels and (once we surfaced it) showed "fill in both labels" even though
  // the user had typed them. Owning the values + validating + calling the
  // action explicitly removes every one of those failure paths.
  const [labelFr, setLabelFr] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [descFr, setDescFr] = useState("");
  const [docType, setDocType] = useState<DocType>("other");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setLabelFr("");
    setLabelEn("");
    setDescFr("");
    setDocType("other");
    setRequired(false);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    // Validate the actual current values — not the DOM at submit time.
    if (!labelFr.trim() || !labelEn.trim()) {
      setError(t("add_item_check_fields"));
      return;
    }

    setPending(true);
    try {
      const fd = new FormData();
      fd.set("engagement_id", engagementId);
      fd.set("label_fr", labelFr.trim());
      fd.set("label_en", labelEn.trim());
      fd.set("description_fr", descFr.trim());
      fd.set("doc_type", docType);
      if (required) fd.set("required", "on");

      const res = await addItemAction(null, fd);
      if (res?.ok) {
        setOpen(false);
        reset();
        // Toast confirms success even when the new row lands far down a long
        // checklist; the action revalidated the cache, refresh re-renders it.
        toast.success(t("item_added"));
        router.refresh();
      } else if (res?.fieldErrors) {
        setError(t("add_item_check_fields"));
      } else {
        setError(t("add_item_error"));
      }
    } catch {
      setError(t("add_item_error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          {t("add_item")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("add_item_title")}</DialogTitle>
          <DialogDescription>{t("add_item_subtitle")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="label_fr">{t("label_fr_placeholder")}</Label>
              <Input
                id="label_fr"
                value={labelFr}
                onChange={(e) => setLabelFr(e.target.value)}
                maxLength={200}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label_en">{t("label_en_placeholder")}</Label>
              <Input
                id="label_en"
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description_fr">
              {t("description_fr_placeholder")}
            </Label>
            <Textarea
              id="description_fr"
              value={descFr}
              onChange={(e) => setDescFr(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="doc_type">{t("doc_type")}</Label>
              <DocTypePicker
                id="doc_type"
                value={docType}
                onChange={setDocType}
                className="w-full"
                province={province}
              />
            </div>
            <label className="flex items-center gap-1.5 select-none cursor-pointer pt-5">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              {t("required")}
            </label>
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
              {pending && <Loader2 className="size-4 animate-spin" />}
              {pending ? tc("saving") : t("add_item")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
