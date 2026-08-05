"use client";

// The bell on a KPI card, and the dialog behind it — Canopy's, copied.
//
// Founder: "built the bell alert thing". Canopy's dialog is titled "Create
// alert for 'Open Tasks'" and carries a condition, a threshold value with the
// current reading under it, a check frequency, a name, and subscribers.
//
// ── WHAT IS THEIRS AND WHAT IS NOT ────────────────────────────────────────
//
// Copied: the bell in the card's hover strip, the dialog title, the
// Condition + Threshold pair, "Current value 69" under the input, the
// frequency line, the pre-filled name, and the custom message checkbox.
//
// NOT copied:
//   * Their Threshold / Scheduled toggle. A "scheduled alert" is a report on a
//     timer, which is an email digest wearing a different hat — and this
//     product's whole thesis is getting email out of the workflow. Thresholds
//     are the half that earns its keep.
//   * Subscriber chips. The rule is personal (RLS scopes every row to its
//     author), and picking recipients raises questions — may a Junior notify
//     the owner? — that the capability model should answer first. The creator
//     is always a subscriber; the column is there for when that is decided.
//
// ⚠️ ONE BELL PER CARD, and it toggles. A card you already watch shows a lit
// bell that deletes rather than opening a second dialog — two alerts on one
// number is a notification you cannot trace back to a rule, and the unique
// index would reject it anyway.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Bell, BellRing } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  createKpiAlertAction,
  deleteKpiAlertAction,
} from "@/app/actions/kpi-alerts";
import type {
  AlertComparator,
  AlertFrequency,
  AlertMetric,
} from "@/lib/dashboard/alert-eval";

export type CardAlert = { id: string; name: string };

export function KpiAlertBell({
  surface,
  metric,
  metricLabel,
  currentValue,
  existing,
  onChanged,
}: {
  surface: "tasks" | "engagements";
  metric: AlertMetric;
  /** The card's own title — the dialog and the default name both quote it. */
  metricLabel: string;
  /** What the number is right now. Canopy prints this under the input, and it
   *  is the single most useful thing on the form: it turns "is 100 a lot?"
   *  into a question you can answer without leaving the dialog. */
  currentValue: number;
  existing?: CardAlert;
  onChanged: () => void;
}) {
  const t = useTranslations("Dashboard");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [comparator, setComparator] = useState<AlertComparator>("gt");
  const [threshold, setThreshold] = useState<string>("");
  const [frequency, setFrequency] = useState<AlertFrequency>("daily");
  const [name, setName] = useState("");
  const [withMessage, setWithMessage] = useState(false);
  const [message, setMessage] = useState("");

  function openDialog() {
    // Pre-filled the way Canopy's is: their threshold box opens on a round
    // number near the current reading and the name reads "Alert on Open Tasks".
    setComparator("gt");
    setThreshold(String(Math.max(1, Math.ceil(currentValue * 1.25))));
    setFrequency("daily");
    setName(t("alert_name_default", { metric: metricLabel }));
    setWithMessage(false);
    setMessage("");
    setOpen(true);
  }

  const report = (error?: string) => {
    toast.error(
      error === "duplicate"
        ? t("alert_error_duplicate")
        : error === "bad_name"
          ? t("alert_error_bad_name")
          : error === "bad_input"
            ? t("alert_error_bad_input")
            : error === "not_ready"
              ? t("alert_error_not_ready")
              : t("alert_error_failed"),
    );
  };

  async function submit() {
    if (busy) return;
    const value = Number(threshold);
    if (!Number.isFinite(value)) {
      report("bad_input");
      return;
    }
    setBusy(true);
    try {
      const res = await createKpiAlertAction({
        surface,
        metric,
        comparator,
        threshold: value,
        frequency,
        name,
        message: withMessage ? message : null,
      });
      if (!res.ok) {
        report(res.error);
        return;
      }
      toast.success(t("alert_created"));
      setOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || busy) return;
    setBusy(true);
    try {
      const res = await deleteKpiAlertAction({ id: existing.id });
      if (!res.ok) {
        report(res.error);
        return;
      }
      toast.success(t("alert_deleted"));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (existing ? void remove() : openDialog())}
        aria-label={existing ? t("alert_delete") : t("alert_bell")}
        title={existing ? `${t("alert_existing")} — ${existing.name}` : t("alert_bell")}
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          existing
            ? // A watched card says so at rest, not only on hover — the whole
              // point of the bell is knowing at a glance which numbers are
              // covered.
              "bg-accent text-accent-foreground"
            : "bg-secondary text-muted-foreground hover:text-foreground",
        )}
      >
        {existing ? (
          <BellRing className="size-4" aria-hidden />
        ) : (
          <Bell className="size-4" aria-hidden />
        )}
      </button>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("alert_title", { metric: metricLabel })}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("alert_condition")}
                </span>
                <select
                  value={comparator}
                  onChange={(e) => setComparator(e.target.value as AlertComparator)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="gt">{t("alert_gt")}</option>
                  <option value="lt">{t("alert_lt")}</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("alert_threshold")}
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
              </label>
            </div>
            {/* Canopy's "Current value 69". Turns "is 100 a lot?" into a
                question you can answer without leaving the dialog. */}
            <p className="-mt-2 text-xs text-muted-foreground">
              {t("alert_current", { value: currentValue })}
            </p>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("alert_frequency")}
              </span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as AlertFrequency)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="hourly">{t("alert_freq_hourly")}</option>
                <option value="daily">{t("alert_freq_daily")}</option>
                <option value="weekly">{t("alert_freq_weekly")}</option>
                <option value="monthly">{t("alert_freq_monthly")}</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("alert_name")}
              </span>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withMessage}
                onChange={(e) => setWithMessage(e.target.checked)}
                className="size-[15px] cursor-pointer accent-[var(--accent)]"
              />
              {t("alert_message")}
            </label>
            {withMessage && (
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("alert_message_placeholder")}
                maxLength={500}
              />
            )}

            {/* Said out loud, because it is the one behaviour somebody would
                otherwise discover by being annoyed. */}
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {t("alert_note_daily")}
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("alert_cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
              {t("alert_create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
