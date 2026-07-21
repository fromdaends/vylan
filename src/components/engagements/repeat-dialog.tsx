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
import {
  ArrowRight,
  Check,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Receipt,
  Square,
  Zap,
} from "lucide-react";
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
  endSeriesAction,
  pauseSeriesAction,
  refreshSeriesSnapshotAction,
  resumeSeriesAction,
  setEngagementRepeatAction,
  setSeriesInvoiceRecreateAction,
  spawnSeriesNowAction,
} from "@/app/actions/recurring";
import { Switch } from "@/components/ui/switch";

export type RepeatFrequencyChoice = "off" | "monthly" | "quarterly" | "yearly";

// What the dialog needs to know about the engagement's series (null = none).
export type EngagementRepeatInfo = {
  id: string;
  frequency: "monthly" | "quarterly" | "yearly";
  dueOffsetDays: number;
  status: "active" | "paused" | "ended";
  nextSpawnOn: string; // ISO date
  // How many documents the series snapshot currently copies onto each new
  // occurrence — shown in the edit-future box.
  itemsCount: number;
  // Invoice recurrence (Phase 4): whether each occurrence gets its own fresh
  // invoice.
  invoiceRecreate: boolean;
};

export function RepeatDialog({
  engagementId,
  locale,
  series,
  invoiceAvailable = false,
  invoiceSummary = null,
  trigger,
}: {
  engagementId: string;
  locale: "fr" | "en";
  series: EngagementRepeatInfo | null;
  // Whether THIS engagement currently has invoice material to copy (automation
  // settings or a live invoice row) — gates the recreate switch.
  invoiceAvailable?: boolean;
  // Server-built one-liner of what each occurrence's invoice will be
  // ("$450.00 · sent when the occurrence is completed").
  invoiceSummary?: string | null;
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

  // Series controls (Phase 3): pause / resume / end + the edit-future
  // snapshot refresh. One pending flag serves all four — the dialog is small
  // enough that only one control runs at a time.
  const [controlPending, startControl] = useTransition();
  const [controlError, setControlError] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [futureApplied, setFutureApplied] = useState(false);
  // Invoice recurrence switch — optimistic, snaps back on failure.
  const [invoiceRecreate, setInvoiceRecreate] = useState(
    series?.invoiceRecreate ?? false,
  );
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  function toggleInvoiceRecreate(enabled: boolean) {
    if (!series) return;
    setInvoiceError(null);
    setInvoiceRecreate(enabled);
    startControl(async () => {
      const result = await setSeriesInvoiceRecreateAction({
        seriesId: series.id,
        engagementId,
        enabled,
      });
      if (!result.ok) {
        setInvoiceRecreate(!enabled);
        setInvoiceError(
          result.error === "no_invoice"
            ? t("repeat_invoice_none")
            : t("repeat_control_error"),
        );
        return;
      }
      router.refresh();
    });
  }

  function runControl(
    action: (input: {
      seriesId: string;
      engagementId: string;
    }) => Promise<{ ok: boolean }>,
    after?: () => void,
  ) {
    if (!series) return;
    setControlError(false);
    setFutureApplied(false);
    startControl(async () => {
      const result = await action({
        seriesId: series.id,
        engagementId,
      });
      if (!result.ok) {
        setControlError(true);
        return;
      }
      after?.();
      router.refresh();
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
          setControlError(false);
          setEndConfirm(false);
          setFutureApplied(false);
          setInvoiceError(null);
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

        {/* Paused banner + Resume. Resuming is FORWARD-ONLY: the server
            reschedules from today; cycles missed while paused are never
            created. */}
        {series && series.status === "paused" && (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Pause className="size-4" aria-hidden />
              {t("repeat_status_paused")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("repeat_resume_hint")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => runControl(resumeSeriesAction)}
              disabled={controlPending}
            >
              {controlPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {t("repeat_resume")}
            </Button>
          </div>
        )}

        {/* Pause / End for a live series. End asks for a second click
            (destructive-ish, though it touches nothing existing). */}
        {series && series.status === "active" && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t("repeat_end_hint")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => runControl(pauseSeriesAction)}
                disabled={controlPending}
              >
                <Pause className="size-4" />
                {t("repeat_pause")}
              </Button>
              {endConfirm ? (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      runControl(endSeriesAction, () => setEndConfirm(false))
                    }
                    disabled={controlPending}
                  >
                    <Square className="size-4" />
                    {t("repeat_end_confirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEndConfirm(false)}
                    disabled={controlPending}
                  >
                    {t("repeat_end_cancel")}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEndConfirm(true)}
                  disabled={controlPending}
                >
                  <Square className="size-4" />
                  {t("repeat_end")}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Invoice recurrence (Phase 4): the switch shows when this
            engagement has invoice material to copy OR recurrence is already
            on (so it can always be turned off). The Automation tab still
            decides WHEN each occurrence's invoice goes out; this decides
            WHETHER each occurrence gets one. */}
        {series &&
          series.status !== "ended" &&
          (invoiceAvailable || invoiceRecreate) && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="repeat-invoice-recreate"
                    className="flex cursor-pointer items-center gap-1.5"
                  >
                    <Receipt
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    {t("repeat_invoice_label")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("repeat_invoice_hint")}
                  </p>
                  {invoiceRecreate && invoiceSummary && (
                    <p className="text-xs font-medium">{invoiceSummary}</p>
                  )}
                </div>
                <Switch
                  id="repeat-invoice-recreate"
                  checked={invoiceRecreate}
                  onCheckedChange={toggleInvoiceRecreate}
                  ariaLabel={t("repeat_invoice_label")}
                />
              </div>
              {invoiceError && (
                <p className="text-sm text-destructive">{invoiceError}</p>
              )}
            </div>
          )}

        {/* Edit-future: re-snapshot this engagement's CURRENT checklist +
            reminder settings onto the series. Future occurrences only —
            structurally incapable of touching existing engagements. */}
        {series && series.status !== "ended" && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ListChecks
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                {t("repeat_future_title")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("repeat_future_count", { count: series.itemsCount })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                runControl(refreshSeriesSnapshotAction, () =>
                  setFutureApplied(true),
                )
              }
              disabled={controlPending}
            >
              {controlPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ListChecks className="size-4" />
              )}
              {t("repeat_future_apply")}
            </Button>
            {futureApplied && (
              <p className="text-sm">
                <Check className="mr-1 inline size-4 text-muted-foreground" />
                {t("repeat_future_applied")}
              </p>
            )}
          </div>
        )}

        {controlError && (
          <p className="text-sm text-destructive">{t("repeat_control_error")}</p>
        )}

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
