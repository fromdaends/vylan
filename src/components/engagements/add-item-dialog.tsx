"use client";

import { useActionState, useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  addItemAction,
  type ItemActionState,
} from "@/app/actions/items";
import { Plus } from "lucide-react";
import { DocTypePicker } from "@/components/engagements/doc-type-picker";
import type { DocType } from "@/lib/db/templates";

export function AddItemDialog({ engagementId }: { engagementId: string }) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<DocType>("other");
  const router = useRouter();
  const [state, action, pending] = useActionState<ItemActionState, FormData>(
    addItemAction,
    null,
  );

  useEffect(() => {
    if (!state?.ok) return;
    queueMicrotask(() => {
      setOpen(false);
      setDocType("other");
      router.refresh();
    });
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
        <form action={action} className="space-y-3">
          <input type="hidden" name="engagement_id" value={engagementId} />
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="label_fr">{t("label_fr_placeholder")}</Label>
              <Input id="label_fr" name="label_fr" required maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label_en">{t("label_en_placeholder")}</Label>
              <Input id="label_en" name="label_en" required maxLength={200} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description_fr">
              {t("description_fr_placeholder")}
            </Label>
            <Textarea
              id="description_fr"
              name="description_fr"
              rows={2}
              maxLength={500}
            />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="doc_type">{t("doc_type")}</Label>
              <input type="hidden" name="doc_type" value={docType} />
              <DocTypePicker
                id="doc_type"
                value={docType}
                onChange={setDocType}
                className="w-full"
              />
            </div>
            <label className="flex items-center gap-1.5 select-none cursor-pointer pt-5">
              <input type="checkbox" name="required" />
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
              {pending ? tc("saving") : t("add_item")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
