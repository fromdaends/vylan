"use client";

// The engagement page's Repeat control (recurring series, migration 0770).
// Lives in the "..." menu like ReminderAutomationDialog and mirrors its
// trigger/save idiom. Phase 1 scope: choose a frequency + due-date offset,
// or turn repeat off (ends the series; existing engagements untouched).
// Pause/resume and edit-future checklist controls arrive in Phase 3.

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowRight, Check, Loader2, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  setEngagementRepeatAction,
  spawnSeriesNowAction,
} from "@/app/actions/recurring";

export type RepeatFrequencyChoice = "off" | "monthly" | "quarterly" | "yearly";

// What the dialog needs to know about the engagement's series (null = none).
export type EngagementRepeatInfo = {
  id: string;
  frequency: "monthly" | "quarterly" | "yearly";
  dueOffsetDays: number;
  status: "active" | "paused" | "ended";
  nextSpawnOn: string; // ISO date
};

export function RepeatDialog({
  engagementId,
  locale,
  series,
  trigger,
}: {
  engagementId: string;
  locale: "fr" | "en";
  series: EngagementRepeatInfo | null;
  trigger: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // An ended series reads as "off" — choosing a frequency again reactivates
  // it (forward-only; the server never backfills).
  const [frequency, setFrequency] = useState<RepeatFrequencyChoice>(
    series && series.status !== "ended" ? series.frequency : "off",
  );
  const [offsetDays, setOffsetDays] = useState<string>(
    String(series?.dueOffsetDays ?? 15),
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The test hook ("spawn next occurrence now"). Its result renders inline:
  // success links to the new engagement; "duplicate" is the anti-duplicate
  // ledger visibly doing its job (second click of the same cycle no-ops).
  const [spawnResult, setSpawnResult] = useState<
    | { kind: "success"; engagementId: string; title: string }
    | { kind: "duplicate" }
    | { kind: "error" }
    | null
  >(null);
  const [spawning, startSpawn] = useTransition();

  function spawnNow() {
    if (!series) return;
    setSpawnResult(null);
    startSpawn(async () => {
      const result = await spawnSeriesNowAction({ seriesId: series.id });
      if (result.ok) {
        setSpawnResult({
          kind: "success",
          engagementId: result.engagementId,
          title: result.title,
        });
        router.refresh();
      } else {
        setSpawnResult({
          kind: result.error === "duplicate" ? "duplicate" : "error",
        });
      }
    });
  }

  const showNext =
    series != null &&
    series.status === "active" &&
    frequency === series.frequency;
  const nextLabel = showNext
    ? new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(new Date(`${series.nextSpawnOn}T12:00:00Z`))
    : null;

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await setEngagementRepeatAction({
        engagementId,
        frequency,
        dueOffsetDays: Math.min(
          365,
          Math.max(1, Math.floor(Number(offsetDays) || 15)),
        ),
      });
      if (!result.ok) {
        setError(
          result.error === "no_documents"
            ? t("repeat_error_no_documents")
            : t("repeat_error"),
        );
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSaved(false);
          setError(null);
          setSpawnResult(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("repeat_dialog_title")}</DialogTitle>
          <DialogDescription>{t("repeat_dialog_desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="repeat-frequency">{t("repeat_frequency_label")}</Label>
          <Select
            value={frequency}
            onValueChange={(value) => {
              setFrequency(value as RepeatFrequencyChoice);
              setSaved(false);
            }}
          >
            <SelectTrigger id="repeat-frequency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("repeat_off")}</SelectItem>
              <SelectItem value="monthly">{t("repeat_monthly")}</SelectItem>
              <SelectItem value="quarterly">{t("repeat_quarterly")}</SelectItem>
              <SelectItem value="yearly">{t("repeat_yearly")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {frequency !== "off" && (
          <div className="space-y-1.5">
            <Label htmlFor="repeat-due-offset">
              {t("repeat_due_offset_label")}
            </Label>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Input
                id="repeat-due-offset"
                type="number"
                min={1}
                max={365}
                value={offsetDays}
                onChange={(event) => {
                  setOffsetDays(event.target.value);
                  setSaved(false);
                }}
                className="h-8 w-20"
              />
              <span>{t("repeat_due_offset_suffix")}</span>
            </div>
          </div>
        )}

        {nextLabel && (
          <p className="text-xs text-muted-foreground">
            {t("repeat_next_occurrence", { date: nextLabel })}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={pending}>
            {saved ? (
              <>
                <Check className="size-4" /> {t("repeat_saved")}
              </>
            ) : (
              t("repeat_save")
            )}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* The founder test hook — only for a live series. Runs the exact
            cron spawn path (force mode), so what it creates is what the
            schedule will create; a second click of the same cycle no-ops. */}
        {series && series.status === "active" && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Zap className="size-4 text-muted-foreground" aria-hidden />
                {t("repeat_spawn_now_title")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("repeat_spawn_now_hint")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={spawnNow}
              disabled={spawning}
            >
              {spawning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Zap className="size-4" />
              )}
              {t("repeat_spawn_now_button")}
            </Button>
            {spawnResult?.kind === "success" && (
              <p className="text-sm">
                <Check className="mr-1 inline size-4 text-muted-foreground" />
                {t("repeat_spawn_now_success", { title: spawnResult.title })}{" "}
                <Link
                  href={{
                    pathname: `/engagements/${spawnResult.engagementId}`,
                  }}
                  className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2"
                >
                  {t("repeat_spawn_now_open")}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </p>
            )}
            {spawnResult?.kind === "duplicate" && (
              <p className="text-sm text-muted-foreground">
                {t("repeat_spawn_now_duplicate")}
              </p>
            )}
            {spawnResult?.kind === "error" && (
              <p className="text-sm text-destructive">
                {t("repeat_spawn_now_error")}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
