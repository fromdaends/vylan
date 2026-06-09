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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { X } from "lucide-react";
import {
  rejectItemAction,
  type ItemActionState,
} from "@/app/actions/items";
import { rejectFileAction } from "@/app/actions/files";

export function RejectModal({
  itemId,
  itemLabel,
  fileId,
  compact = false,
  active = false,
  suggestions: customSuggestions,
}: {
  itemId: string;
  itemLabel: string;
  // When set, reject just this ONE file (per-document) via rejectFileAction
  // instead of the whole item.
  fileId?: string;
  // Render an icon-only trigger (a compact X) instead of the full "Reject"
  // button — used per signed-copy so the controls stay tight.
  compact?: boolean;
  // The file is already rejected — show the icon trigger in its active (red)
  // state so the current decision is visible at a glance.
  active?: boolean;
  // Optional override for the quick-fill reason chips. Defaults to the
  // document-collection suggestions; a signature reject passes its own (a
  // signed copy can't be "the wrong year" or "missing pages").
  suggestions?: string[];
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  // Per-file and item-level reject share the same FormData shape ({id, reason})
  // and result shape, so the modal just switches the action + the id it sends.
  const rejectAction = (
    fileId ? rejectFileAction : rejectItemAction
  ) as typeof rejectItemAction;
  const rejectId = fileId ?? itemId;
  const [state, action, pending] = useActionState<ItemActionState, FormData>(
    rejectAction,
    null,
  );

  useEffect(() => {
    if (!state?.ok) return;
    queueMicrotask(() => {
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }, [state, router]);

  const suggestions = customSuggestions ?? [
    t("reject_suggestion_wrong_doc"),
    t("reject_suggestion_wrong_year"),
    t("reject_suggestion_illegible"),
    t("reject_suggestion_missing_pages"),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("reject")}
            title={t("reject")}
            className={
              active
                ? "bg-destructive text-white hover:bg-destructive/90"
                : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            }
          >
            <X className="size-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <X className="size-4" />
            {t("reject")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("reject_title")}</DialogTitle>
          <DialogDescription>
            {t("reject_subtitle", { label: itemLabel })}
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={rejectId} />
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="reason">{t("reject_reason_label")}</Label>
            <Textarea
              id="reason"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={2}
              maxLength={500}
              rows={3}
              placeholder={t("reject_reason_placeholder")}
              aria-invalid={Boolean(state?.fieldErrors?.reason)}
            />
            <p className="text-xs text-muted-foreground">
              {t("reject_reason_privacy_hint")}
            </p>
            {state?.fieldErrors?.reason && (
              <p className="text-sm text-destructive">
                {state.fieldErrors.reason}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setReason(s)}
                className="text-xs rounded-full border border-border px-2 py-1 hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                {s}
              </button>
            ))}
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
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? tc("saving") : t("confirm_reject")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
