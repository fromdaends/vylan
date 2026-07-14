"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BellRing, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_REMINDER_SETTINGS,
  normalizeReminderSettings,
  type ReminderSettings,
  type ReminderStep,
  type ReminderTone,
} from "@/lib/reminder-settings";

export function ReminderAutomationDefaults({
  initialSettings,
}: {
  initialSettings: ReminderSettings | null;
}) {
  const t = useTranslations("Settings");
  const te = useTranslations("Engagements");
  const [settings, setSettings] = useState<ReminderSettings>(() =>
    structuredClone(initialSettings ?? DEFAULT_REMINDER_SETTINGS),
  );
  const [hasDefault, setHasDefault] = useState(initialSettings !== null);
  const [editing, setEditing] = useState(initialSettings !== null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  function updateStep(tone: ReminderTone, patch: Partial<ReminderStep>) {
    setStatus(null);
    setSettings((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.tone === tone ? { ...step, ...patch } : step,
      ),
    }));
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    const normalized = normalizeReminderSettings({ ...settings, enabled: true });
    try {
      const response = await fetch("/api/firm/reminder-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: normalized }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? payload?.error ?? `HTTP ${response.status}`);
      }
      setSettings(normalized);
      setHasDefault(true);
      setStatus("saved");
    } catch (error) {
      console.error("[reminder-defaults] save failed:", error);
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("reminder_defaults_remove_confirm"))) return;
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch("/api/firm/reminder-defaults", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSettings(structuredClone(DEFAULT_REMINDER_SETTINGS));
      setHasDefault(false);
      setEditing(false);
    } catch (error) {
      console.error("[reminder-defaults] remove failed:", error);
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-xl">
      <div className="flex items-start gap-2">
        <BellRing className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold">
            {t("reminder_defaults_title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("reminder_defaults_hint")}
          </p>
        </div>
      </div>

      {!editing ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setEditing(true)}
        >
          {t("reminder_defaults_create")}
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
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
                  {te(`reminder_tone_${step.tone}`)}
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
                          Math.max(1, Math.floor(Number(event.target.value) || 1)),
                        ),
                      })
                    }
                    aria-label={te("reminder_days_label")}
                    className="h-8 w-20"
                  />
                  <span>
                    {step.timing === "after_due"
                      ? te("reminder_days_after_due")
                      : te("reminder_days_after_send")}
                  </span>
                  <span>{te("reminder_repeat_prefix")}</span>
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
                          Math.max(1, Math.floor(Number(event.target.value) || 1)),
                        ),
                      })
                    }
                    aria-label={te("reminder_repeat_label")}
                    className="h-8 w-16"
                  />
                  <span>{te("reminder_repeat_suffix")}</span>
                </div>
              </div>

              {step.enabled && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {te("reminder_subject_label")}
                    </Label>
                    <Input
                      value={step.customSubject ?? ""}
                      maxLength={160}
                      onChange={(event) =>
                        updateStep(step.tone, {
                          customSubject: event.target.value || null,
                        })
                      }
                      placeholder={te("reminder_subject_placeholder")}
                    />
                  </div>
                  <div className="space-y-1.5 sm:row-span-2">
                    <Label className="text-xs text-muted-foreground">
                      {te("reminder_message_label")}
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
                      placeholder={te("reminder_message_placeholder")}
                    />
                  </div>
                  <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                    {te("reminder_tokens_hint")}
                  </p>
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" size="sm" disabled={saving} onClick={save}>
              {saving ? t("saving") : t("reminder_defaults_save")}
            </Button>
            {hasDefault && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={remove}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" aria-hidden />
                {t("reminder_defaults_remove")}
              </Button>
            )}
            {status === "saved" && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                {t("reminder_defaults_saved")}
              </span>
            )}
            {status === "error" && (
              <span className="text-xs text-destructive">{t("save_failed")}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
