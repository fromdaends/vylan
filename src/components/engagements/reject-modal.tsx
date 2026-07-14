"use client";

import { useState } from "react";
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

export function RejectModal({
  itemId,
  itemLabel,
  fileId,
  compact = false,
  active = false,
  suggestions: customSuggestions,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  itemId: string;
  itemLabel: string;
  // When set, reject just this ONE file (per-document); otherwise the whole item.
  fileId?: string;
  // Render an icon-only trigger (a compact X) instead of the full "Reject"
  // button — used per signed-copy so the controls stay tight.
  compact?: boolean;
  // The file is already rejected — show the icon trigger in its active (red)
  // state so the current decision is visible at a glance.
  active?: boolean;
  // Optional override for the quick-fill reason chips. Defaults to the
  // document-collection suggestions; a signature reject passes its own.
  suggestions?: string[];
  // A controlled, triggerless mode lets file-row action menus open this same
  // dialog from either the kebab menu or the right-click menu.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const [internalOpen, setInternalOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const open = controlledOpen ?? internalOpen;

  function setOpen(next: boolean) {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  // STABLE URL endpoints (not Server Actions) so a deploy/version mismatch can't
  // make the click fail silently before it reaches the server — the bug where
  // "Reject" did nothing and the row stayed stale. Mirrors the add-item dialog.
  const endpoint = fileId
    ? `/api/files/${fileId}/reject`
    : `/api/items/${itemId}/reject`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const trimmed = reason.trim();
    if (trimmed.length < 2) {
      setError(t("reject_reason_min"));
      return;
    }
    setPending(true);
    try {
      const fd = new FormData();
      fd.set("reason", trimmed);
      const r = await fetch(endpoint, { method: "POST", body: fd });
      const res = (await r.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        fieldErrors?: Record<string, string>;
      } | null;
      if (res?.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
      } else if (res?.fieldErrors?.reason) {
        setError(
          res.fieldErrors.reason === "too_long"
            ? t("reject_reason_max")
            : t("reject_reason_min"),
        );
      } else {
        setError(res?.detail || t("reject_error"));
      }
    } catch {
      setError(t("reject_error"));
    } finally {
      setPending(false);
    }
  }

  const suggestions = customSuggestions ?? [
    t("reject_suggestion_wrong_doc"),
    t("reject_suggestion_wrong_year"),
    t("reject_suggestion_illegible"),
    t("reject_suggestion_missing_pages"),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {!hideTrigger && (
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
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("reject_title")}</DialogTitle>
          <DialogDescription>
            {t("reject_subtitle", { label: itemLabel })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
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
            />
            <p className="text-xs text-muted-foreground">
              {t("reject_reason_privacy_hint")}
            </p>
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
