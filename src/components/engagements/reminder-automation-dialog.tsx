"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellOff, Check } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateReminderAutomationAction } from "@/app/actions/engagements";
import {
  normalizeReminderSettings,
  type ReminderSettings,
  type ReminderStep,
  type ReminderTone,
} from "@/lib/reminder-settings";

export function ReminderAutomationDialog({
  engagementId,
  initialSettings,
  initiallyPaused,
  trigger,
}: {
  engagementId: string;
  initialSettings: ReminderSettings;
  initiallyPaused: boolean;
  trigger: ReactNode;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(() =>
    structuredClone(normalizeReminderSettings(initialSettings)),
  );
  const [paused, setPaused] = useState(initiallyPaused);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  function updateStep(tone: ReminderTone, patch: Partial<ReminderStep>) {
    setSaved(false);
    setSettings((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.tone === tone ? { ...step, ...patch } : step,
      ),
    }));
  }

  function save() {
    setSaved(false);
    setError(false);
    startTransition(async () => {
      const normalized = normalizeReminderSettings(settings);
      const result = await updateReminderAutomationAction({
        engagementId,
        settings: normalized,
        paused,
      });
      if (!result.ok) {
        setError(true);
        return;
      }
      setSettings(normalized);
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
          setError(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("reminder_dialog_title")}</DialogTitle>
          <DialogDescription>{t("reminder_dialog_desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
          <div className="flex gap-2">
            <BellOff className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <Label htmlFor="pause-reminders" className="cursor-pointer">
                {t("reminder_pause_label")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("reminder_pause_hint")}
              </p>
            </div>
          </div>
          <Switch
            id="pause-reminders"
            checked={paused}
            onCheckedChange={(value) => {
              setPaused(value);
              setSaved(false);
            }}
            ariaLabel={t("reminder_pause_label")}
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
          <div>
            <Label htmlFor="reminder-schedule-enabled" className="cursor-pointer">
              {t("reminder_schedule_enabled")}
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("reminder_schedule_enabled_hint")}
            </p>
          </div>
          <Switch
            id="reminder-schedule-enabled"
            checked={settings.enabled}
            onCheckedChange={(enabled) => {
              setSettings((current) => ({ ...current, enabled }));
              setSaved(false);
            }}
            ariaLabel={t("reminder_schedule_enabled")}
          />
        </div>

        {settings.enabled && (
          <div className="space-y-3">
            {settings.steps.map((step) => (
              <div
                key={step.tone}
                className="space-y-3 rounded-lg border border-border bg-muted/20 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={step.enabled}
                      onChange={(event) =>
                        updateStep(step.tone, { enabled: event.target.checked })
                      }
                    />
                    {t(`reminder_tone_${step.tone}`)}
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={step.days}
                      disabled={!step.enabled}
                      onChange={(event) =>
                        updateStep(step.tone, {
                          days: Math.min(
                            365,
                            Math.max(
                              1,
                              Math.floor(Number(event.target.value) || 1),
                            ),
                          ),
                        })
                      }
                      aria-label={t("reminder_days_label")}
                      className="h-8 w-20"
                    />
                    <span>
                      {step.timing === "after_due"
                        ? t("reminder_days_after_due")
                        : t("reminder_days_after_send")}
                    </span>
                    <span>{t("reminder_repeat_prefix")}</span>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={step.repeatCount}
                      disabled={!step.enabled}
                      onChange={(event) =>
                        updateStep(step.tone, {
                          repeatCount: Math.min(
                            12,
                            Math.max(
                              1,
                              Math.floor(Number(event.target.value) || 1),
                            ),
                          ),
                        })
                      }
                      aria-label={t("reminder_repeat_label")}
                      className="h-8 w-16"
                    />
                    <span>{t("reminder_repeat_suffix")}</span>
                  </div>
                </div>

                {step.enabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("reminder_subject_label")}
                      </Label>
                      <Input
                        value={step.customSubject ?? ""}
                        maxLength={160}
                        onChange={(event) =>
                          updateStep(step.tone, {
                            customSubject: event.target.value || null,
                          })
                        }
                        placeholder={t("reminder_subject_placeholder")}
                      />
                    </div>
                    <div className="space-y-1.5 sm:row-span-2">
                      <Label className="text-xs text-muted-foreground">
                        {t("reminder_message_label")}
                      </Label>
                      <Textarea
                        value={step.customMessage ?? ""}
                        maxLength={2000}
                        rows={3}
                        onChange={(event) =>
                          updateStep(step.tone, {
                            customMessage: event.target.value || null,
                          })
                        }
                        placeholder={t("reminder_message_placeholder")}
                      />
                    </div>
                    <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                      {t("reminder_tokens_hint")}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={pending}>
            {saved ? (
              <>
                <Check className="size-4" /> {t("reminder_saved")}
              </>
            ) : (
              t("reminder_save")
            )}
          </Button>
          {error && (
            <p className="text-sm text-destructive">{t("reminder_save_error")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
