"use client";

// Import clients — the wizard's SINGLE-CARD shape, and nothing more.
//
// ── WHAT THIS DOES AND DELIBERATELY DOES NOT DO ────────────────────────────
//
// It takes a CSV and hands it to the review page. That is the whole job. The
// parsing, the row-by-row preview, the "3 of 47 rows have a problem" table and
// the commit all already live on /clients/import, and they are the part that
// matters — the founder's own rule, from the file that page lives in: nothing
// is created until every row has been looked at.
//
// So this card is the doorway that used to be a plain link, wearing the same
// clothes as every other create flow. Its footnote promises the review, because
// a drop zone with a primary button under it otherwise reads like a control
// that imports on click.
//
// ── WHY sessionStorage AND NOT A PROP ──────────────────────────────────────
//
// A File cannot survive a navigation, and a CSV can be a hundred kilobytes —
// far past what a query string will carry. The text is stashed under one key,
// read once on the other side and deleted immediately, so a stale paste can
// never reappear on a later visit.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { TemplateBuilderShell } from "@/components/templates/template-builder-shell";
import { cn } from "@/lib/cn";

/** Read once by the review page, then removed. Exported so the two sides
 *  cannot drift onto different keys. */
export const IMPORT_HANDOFF_KEY = "vylan:pending-client-csv";

export function ClientImportCard() {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function take(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ""));
      setFileName(file.name);
    };
    reader.readAsText(file);
  }

  function go() {
    // An EMPTY hand-off is still a valid one: it means "I have no file yet",
    // and the review page's paste box is the right place to end up.
    if (csv) {
      try {
        sessionStorage.setItem(IMPORT_HANDOFF_KEY, csv);
      } catch {
        // Private mode, or a quota. The review page's paste box still works,
        // so losing the hand-off costs a re-drop rather than the import.
      }
    }
    setOpen(false);
    router.push("/clients/import");
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="h-[42px] gap-[7px] rounded-[10px] px-3.5 text-sm font-medium text-muted-foreground"
      >
        <Upload className="h-4 w-4" />
        {t("import_csv")}
      </Button>

      {open && (
        <TemplateBuilderShell
          title={t("import_csv")}
          explainer={t("import_card_explainer")}
          tabs={[{ key: "only", label: t("import_csv") }]}
          activeTab="only"
          onTabChange={() => {}}
          finalAction={{ label: t("import_card_continue"), onClick: go }}
          onClose={() => setOpen(false)}
        >
          <div className="space-y-3.5">
            {/* A LABEL wrapping the input, not a div with an onClick — the
                whole zone is the file picker's own hit area that way, and it
                stays reachable by keyboard for free. */}
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                take(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed px-6 py-11 text-center transition-colors",
                dragging
                  ? "border-accent bg-accent-subtle"
                  : "border-border hover:border-accent/50 hover:bg-muted/50",
              )}
            >
              <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
                <Upload className="size-5" aria-hidden />
              </span>
              <span className="text-sm font-[550]">
                {fileName ?? t("import_drop_title")}
              </span>
              <span className="max-w-[44ch] text-[12.5px] leading-relaxed text-muted-foreground">
                {fileName ? t("import_drop_ready") : t("import_drop_hint")}
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => take(e.target.files?.[0])}
              />
            </label>

            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {t("import_card_footnote")}
            </p>
          </div>
        </TemplateBuilderShell>
      )}
    </>
  );
}
