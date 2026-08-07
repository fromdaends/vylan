"use client";

// The engagement letter FOR ONE SERVICE — the founder's model: "accountants
// have a specific engagement letter that they send per service."
//
// So it sits inside the service builder, beside the price and the work that
// service implies, rather than as a firm-wide setting. One row per language,
// because half this client book is French and a French client should receive
// French terms.
//
// Uploads immediately on pick rather than waiting for the service's Save:
// the file goes to storage and its own row, not into the service form's
// state, and pretending otherwise would mean holding a PDF in memory across
// an unrelated save.

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FileSignature, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  removeEngagementLetterAction,
  uploadEngagementLetterAction,
} from "@/app/actions/engagement-letters";

export type ServiceLetterRow = {
  locale: "en" | "fr";
  fileName: string;
  uploadedAt: string;
};

export function ServiceLetterSection({
  serviceId,
  initial,
  onRowsChange,
}: {
  /** Null while the service is still being created — there is no row to hang
   *  a file on yet, so the section explains that instead of half-working. */
  serviceId: string | null;
  initial: ServiceLetterRow[];
  /** Fired after any successful upload/remove — the engagement builder's
   *  inline mount uses it to keep its letter honesty line truthful. */
  onRowsChange?: (rows: ServiceLetterRow[]) => void;
}) {
  const t = useTranslations("Templates");
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState<ServiceLetterRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  if (!serviceId) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("service_letter_save_first")}
      </p>
    );
  }

  function upload(locale: "en" | "fr", file: File) {
    if (!serviceId) return;
    setBusy(locale);
    const fd = new FormData();
    fd.set("service_id", serviceId);
    fd.set("locale", locale);
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadEngagementLetterAction(fd);
      setBusy(null);
      if (res.ok) {
        // Computed OUTSIDE the state updater: onRowsChange sets PARENT state,
        // and a side effect inside an updater runs during render (React
        // "cannot update a component while rendering" — updaters must be
        // pure). `rows` is current here: uploads are single-flight (busy).
        const next = [
          ...rows.filter((r) => r.locale !== locale),
          { locale, fileName: file.name, uploadedAt: new Date().toISOString() },
        ];
        setRows(next);
        onRowsChange?.(next);
        toast.success(t("service_letter_saved"));
      } else {
        toast.error(
          res.error === "file_type"
            ? t("service_letter_error_pdf")
            : res.error === "file_size"
              ? t("service_letter_error_size")
              : t("service_letter_error_save"),
        );
      }
    });
  }

  function remove(locale: "en" | "fr") {
    if (!serviceId) return;
    setBusy(locale);
    const fd = new FormData();
    fd.set("service_id", serviceId);
    fd.set("locale", locale);
    startTransition(async () => {
      const res = await removeEngagementLetterAction(fd);
      setBusy(null);
      if (res.ok) {
        // Same purity rule as upload() above.
        const next = rows.filter((r) => r.locale !== locale);
        setRows(next);
        onRowsChange?.(next);
        toast.success(t("service_letter_removed"));
      } else {
        toast.error(t("service_letter_error_save"));
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("service_letter_hint")}
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        {(["en", "fr"] as const).map((locale) => {
          const row = rows.find((r) => r.locale === locale);
          return (
            <div
              key={locale}
              className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
            >
              <FileSignature
                className="size-3.5 shrink-0 text-accent"
                aria-hidden
              />
              <span className="text-xs font-medium">
                {t(`service_letter_lang_${locale}`)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {row ? row.fileName : t("service_letter_none")}
              </span>
              <input
                ref={(el) => {
                  inputs.current[locale] = el;
                }}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Clear first: picking the SAME file twice must still fire
                  // change (the input keeps its value otherwise).
                  e.target.value = "";
                  if (file) upload(locale, file);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => inputs.current[locale]?.click()}
              >
                <Upload className="mr-1.5 size-3" aria-hidden />
                {row ? t("service_letter_replace") : t("service_letter_upload")}
              </Button>
              {row && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy !== null}
                  aria-label={t("service_letter_remove")}
                  onClick={() => remove(locale)}
                >
                  <Trash2 className="size-3" aria-hidden />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
