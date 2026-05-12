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
import type { DocType } from "@/lib/db/templates";
import { Plus } from "lucide-react";

const DOC_TYPES: DocType[] = [
  "t4", "rl1", "t5", "rl3", "t3", "rl16", "noa",
  "bank_statement", "credit_card_statement", "receipt",
  "t2202", "rrsp", "medical", "donation", "rental",
  "gst_hst_qst", "trial_balance", "gl_export", "financials",
  "shareholder_loan", "payroll_summary", "capital_asset",
  "inventory", "invoice", "other",
];

export function AddItemDialog({ engagementId }: { engagementId: string }) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [state, action, pending] = useActionState<ItemActionState, FormData>(
    addItemAction,
    null,
  );

  useEffect(() => {
    if (!state?.ok) return;
    queueMicrotask(() => {
      setOpen(false);
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
              <select
                id="doc_type"
                name="doc_type"
                defaultValue="other"
                className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs h-9"
              >
                {DOC_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {dt}
                  </option>
                ))}
              </select>
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
