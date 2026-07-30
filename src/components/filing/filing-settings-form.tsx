"use client";

// Folder-structure + naming settings with a LIVE preview. The preview runs the
// exact pure render functions the engine uses (template.ts), on a real recent
// document when the firm has one — what you see is literally what will file.

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronRight, FileText, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import {
  renderFullPath,
  validateFolderTemplate,
  validateNameTemplate,
} from "@/lib/filing/template";
import {
  FILING_TOKEN_NAMES,
  type FilingLanguage,
  type FilingTokenContext,
} from "@/lib/filing/tokens";
import {
  saveFilingSettingsAction,
  type SaveFilingSettingsState,
} from "@/app/actions/filing";

type Props = {
  initial: {
    folderTemplate: string;
    nameTemplate: string;
    language: FilingLanguage;
    autoFileOnComplete: boolean;
    fileRejected: boolean;
  };
  sample: FilingTokenContext;
  yearlessSample: FilingTokenContext;
  sampleIsReal: boolean;
  isOwner: boolean;
  // False until migration 0900 is applied (preview deploys before prod apply).
  available: boolean;
};

export function FilingSettingsForm({
  initial,
  sample,
  yearlessSample,
  sampleIsReal,
  isOwner,
  available,
}: Props) {
  const t = useTranslations("Filing");
  const [folderTemplate, setFolderTemplate] = useState(initial.folderTemplate);
  const [nameTemplate, setNameTemplate] = useState(initial.nameTemplate);
  const [language, setLanguage] = useState<FilingLanguage>(initial.language);
  const [autoFile, setAutoFile] = useState(initial.autoFileOnComplete);
  const [fileRejected, setFileRejected] = useState(initial.fileRejected);
  const [saving, startSaving] = useTransition();

  const folderRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Which input receives clicked token chips (the last one focused).
  const [chipTarget, setChipTarget] = useState<"folder" | "name">("folder");

  const folderCheck = useMemo(
    () => validateFolderTemplate(folderTemplate),
    [folderTemplate],
  );
  const nameCheck = useMemo(
    () => validateNameTemplate(nameTemplate),
    [nameTemplate],
  );

  const preview = useMemo(
    () => renderFullPath(folderTemplate, nameTemplate, sample, language),
    [folderTemplate, nameTemplate, sample, language],
  );
  const yearlessPreview = useMemo(
    () =>
      renderFullPath(folderTemplate, nameTemplate, yearlessSample, language),
    [folderTemplate, nameTemplate, yearlessSample, language],
  );

  const editable = isOwner;
  const valid = folderCheck.ok && nameCheck.ok;

  function insertToken(token: string) {
    const target = chipTarget === "folder" ? folderRef : nameRef;
    const setValue = chipTarget === "folder" ? setFolderTemplate : setNameTemplate;
    const el = target.current;
    const text = `{${token}}`;
    if (!el) {
      setValue((v) => v + text);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setValue(next);
    // Restore focus + put the caret after the inserted token.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function errorCopy(
    check: ReturnType<typeof validateFolderTemplate>,
    kind: "folder" | "name",
  ): string | null {
    if (check.ok) return null;
    switch (check.error) {
      case "empty":
      case "no_output":
        return t(kind === "folder" ? "error_folder_empty" : "error_name_empty");
      case "unknown_token":
        return t("error_unknown_token", {
          tokens: (check.unknownTokens ?? []).join(", "),
        });
      case "too_deep":
        return t("error_too_deep");
      case "missing_client_token":
        return t("error_missing_client_token");
    }
  }

  function save() {
    startSaving(async () => {
      const result: SaveFilingSettingsState = await saveFilingSettingsAction({
        folderTemplate,
        nameTemplate,
        language,
        autoFileOnComplete: autoFile,
        fileRejected,
      });
      if (result?.ok) {
        toast.success(t("saved"));
      } else {
        toast.error(
          result?.error === "unavailable" ? t("unavailable_body") : t("save_failed"),
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      {!available && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-foreground/80">
          {t("unavailable_body")}
        </p>
      )}

      {/* Templates */}
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="filing-folder">{t("folder_label")}</Label>
          <Input
            id="filing-folder"
            ref={folderRef}
            value={folderTemplate}
            onChange={(e) => setFolderTemplate(e.target.value)}
            onFocus={() => setChipTarget("folder")}
            disabled={!editable}
            spellCheck={false}
            className="font-mono text-[13px]"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("folder_hint")}
          </p>
          {errorCopy(folderCheck, "folder") && (
            <p className="text-xs font-medium text-destructive">
              {errorCopy(folderCheck, "folder")}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="filing-name">{t("name_label")}</Label>
          <Input
            id="filing-name"
            ref={nameRef}
            value={nameTemplate}
            onChange={(e) => setNameTemplate(e.target.value)}
            onFocus={() => setChipTarget("name")}
            disabled={!editable}
            spellCheck={false}
            className="font-mono text-[13px]"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("name_hint")}
          </p>
          {errorCopy(nameCheck, "name") && (
            <p className="text-xs font-medium text-destructive">
              {errorCopy(nameCheck, "name")}
            </p>
          )}
        </div>

        {/* Token chips */}
        {editable && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {t("tokens_label", {
                target:
                  chipTarget === "folder"
                    ? t("tokens_target_folder")
                    : t("tokens_target_name"),
              })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FILING_TOKEN_NAMES.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className={cn(
                    "rounded-md border border-border/70 bg-secondary/50 px-2 py-1 font-mono text-[11px] text-foreground/80",
                    "transition-colors hover:border-border hover:bg-secondary hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {`{${token}}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-border/60 bg-secondary/30 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("preview_label")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {sampleIsReal ? t("preview_real_doc") : t("preview_sample_doc")}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-sm">
          {preview.segments.map((segment, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && (
                <ChevronRight
                  className="size-3.5 text-muted-foreground/60"
                  aria-hidden
                />
              )}
              <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-1 ring-1 ring-inset ring-border/60">
                <Folder className="size-3.5 text-icon-amber" aria-hidden />
                <span className="font-medium">{segment}</span>
              </span>
            </span>
          ))}
          <ChevronRight
            className="size-3.5 text-muted-foreground/60"
            aria-hidden
          />
          <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-1 ring-1 ring-inset ring-border/60">
            <FileText className="size-3.5 text-icon-blue" aria-hidden />
            <span className="font-medium">{preview.fileName}</span>
          </span>
        </div>

        {/* What happens when the year can't be read — showing the fallback is
            what prevents the support ticket. */}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t("preview_yearless", {
            path: [...yearlessPreview.segments, yearlessPreview.fileName].join(
              " / ",
            ),
          })}
        </p>
      </div>

      {/* Language + auto-file + save */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="filing-language">{t("language_label")}</Label>
            <p className="text-xs text-muted-foreground">{t("language_hint")}</p>
          </div>
          <Select
            value={language}
            onValueChange={(v) => setLanguage(v === "fr" ? "fr" : "en")}
            disabled={!editable}
          >
            <SelectTrigger id="filing-language" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("language_en")}</SelectItem>
              <SelectItem value="fr">{t("language_fr")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="filing-auto">{t("auto_label")}</Label>
            <p className="text-xs text-muted-foreground">{t("auto_hint")}</p>
          </div>
          <Switch
            id="filing-auto"
            checked={autoFile}
            onCheckedChange={setAutoFile}
            disabled={!editable}
          />
        </div>

        {/* Rejected documents. This has ALWAYS been the behaviour — the engine
            refuses a rejected document outright — so the switch does not change
            anything by existing. It makes an invisible guarantee visible, and
            gives a firm that wants a complete archive rather than a clean one
            the ability to say so. Off by default, and off is the safe side:
            filing a rejected document beside the good copy is how the wrong
            version ends up in someone's books. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="filing-rejected">{t("rejected_label")}</Label>
            <p className="text-xs text-muted-foreground">{t("rejected_hint")}</p>
          </div>
          <Switch
            id="filing-rejected"
            checked={fileRejected}
            onCheckedChange={setFileRejected}
            disabled={!editable}
          />
        </div>

        {editable ? (
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving || !valid}>
              {saving && <Loader2 className="animate-spin" />}
              {t("save")}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("owner_only_note")}</p>
        )}
      </div>
    </div>
  );
}
