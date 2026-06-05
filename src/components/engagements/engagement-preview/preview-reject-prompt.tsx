"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// Small reason prompt for rejecting a document from the grid (or the detail
// view). Rejecting requires a reason because the client sees it and is asked to
// re-upload — so this collects one, with quick suggestion chips. Renders above
// the Preview panel (z-[70]); reused by the click-in detail view in Phase 4.
export function PreviewRejectPrompt({
  docHeader,
  busy,
  onCancel,
  onConfirm,
}: {
  docHeader: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations("Preview");
  const [reason, setReason] = useState("");
  const suggestions = [
    t("reject_reason_blurry"),
    t("reject_reason_wrong_doc"),
    t("reject_reason_incomplete"),
    t("reject_reason_wrong_name"),
  ];
  const valid = reason.trim().length >= 2;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 motion-safe:animate-in motion-safe:fade-in-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("reject_title")}
        className="w-full max-w-md rounded-xl border border-border/60 bg-background p-5 shadow-2xl motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-150"
      >
        <h3 className="text-base font-semibold tracking-tight">
          {t("reject_title")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {docHeader} · {t("reject_subtitle")}
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          autoFocus
          placeholder={t("reject_placeholder")}
          aria-label={t("reject_placeholder")}
          className="mt-3 w-full resize-none rounded-lg border border-border/40 bg-card/40 p-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring/60"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setReason(s)}
              className="cursor-pointer rounded-full border border-border/40 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => valid && onConfirm(reason.trim())}
            disabled={!valid || busy}
          >
            {busy ? t("rejecting") : t("reject_confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
