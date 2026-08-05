"use client";

// "Engagement letter" — the firm's one-time setup for the document its
// automations send.
//
// It lives beside the automations library rather than in Settings because
// this is the file the "Send engagement letter" switch above actually sends,
// and the founder's own ruling on the library was to put a thing where the
// thing it belongs to is. One row per language: half this client book is
// French, and a French client should receive a French letter.

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FileSignature, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  removeEngagementLetterAction,
  uploadEngagementLetterAction,
} from "@/app/actions/engagement-letters";

export type LetterRow = {
  locale: "en" | "fr";
  fileName: string;
  uploadedAt: string;
};

export function EngagementLetterCard({
  letters,
  canManage,
}: {
  letters: LetterRow[];
  canManage: boolean;
}) {
  const t = useTranslations("Automations");
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const byLocale = (l: "en" | "fr") => letters.find((x) => x.locale === l);

  function upload(locale: "en" | "fr", file: File) {
    setBusy(locale);
    const fd = new FormData();
    fd.set("locale", locale);
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadEngagementLetterAction(fd);
      setBusy(null);
      if (res.ok) {
        toast.success(t("letter_saved"));
      } else {
        toast.error(
          res.error === "file_type"
            ? t("letter_error_pdf")
            : res.error === "file_size"
              ? t("letter_error_size")
              : t("error_save"),
        );
      }
    });
  }

  function remove(locale: "en" | "fr") {
    setBusy(locale);
    const fd = new FormData();
    fd.set("locale", locale);
    startTransition(async () => {
      const res = await removeEngagementLetterAction(fd);
      setBusy(null);
      if (res.ok) toast.success(t("letter_removed"));
      else toast.error(t("error_save"));
    });
  }

  return (
    <section aria-labelledby="letter-setup" className="mb-10">
      <h2
        id="letter-setup"
        className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {t("letter_title")}
      </h2>
      <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
        {t("letter_intro")}
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {(["en", "fr"] as const).map((locale) => {
          const row = byLocale(locale);
          return (
            <div
              key={locale}
              className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <FileSignature
                className="size-4 shrink-0 text-accent"
                aria-hidden
              />
              <span className="text-sm font-medium">
                {t(`letter_lang_${locale}`)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {row ? row.fileName : t("letter_none")}
              </span>

              {canManage && (
                <div className="flex items-center gap-1.5">
                  <input
                    ref={(el) => {
                      inputs.current[locale] = el;
                    }}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Clear first: picking the SAME file twice must still
                      // fire change (the input keeps its value otherwise).
                      e.target.value = "";
                      if (file) upload(locale, file);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => inputs.current[locale]?.click()}
                  >
                    <Upload className="mr-1.5 size-3.5" aria-hidden />
                    {row ? t("letter_replace") : t("letter_upload")}
                  </Button>
                  {row && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={busy !== null}
                      aria-label={t("letter_remove")}
                      onClick={() => remove(locale)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {letters.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("letter_hint_empty")}
        </p>
      )}
    </section>
  );
}
