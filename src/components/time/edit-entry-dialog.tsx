"use client";

// Editing one time entry — day, duration, note.
//
// A DIALOG rather than the app's usual anchored popover because its two
// callers have no stable anchor: the stop-toast's Edit button lives in a
// transient toast, and the list rows re-render under an inline edit. Small,
// three fields, no steps.
//
// The form is KEYED by entry id, so opening a different entry remounts it with
// fresh state — state-reset-by-key instead of a re-seeding effect, per the
// React Compiler rules this repo enforces.
//
// Duration is typed the way it was logged — "1:30", "1.5", "90m" — through the
// same parser the manual dialog uses. formatMinutes() round-trips through that
// parser ("1h 30m" parses to 90), so opening and saving unchanged is a no-op.

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatMinutes,
  parseDurationToMinutes,
} from "@/lib/time/duration";
import { updateTimeEntryAction } from "@/app/actions/time-entries";
import { formatCurrency, type AppLocale } from "@/lib/format";

export type EditableEntry = {
  id: string;
  /** YYYY-MM-DD as currently stored (firm-tz day). */
  day: string;
  durationMinutes: number;
  note: string | null;
};

export function EditEntryDialog({
  entry,
  valueCents = null,
  notice = null,
  onClose,
  onSaved,
}: {
  entry: EditableEntry | null;
  /** The entry's value at its billable-rate snapshot (timer v2) — shown, not
   *  editable; null = no rate recorded, rendered as its own honest line. Only
   *  passed where the caller may see it (the RLS on the billing table decides
   *  who that is). */
  valueCents?: number | null;
  /** One-line context above the fields — the 12h auto-stop explanation. */
  notice?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Time");

  return (
    <Dialog open={entry != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("edit_title")}</DialogTitle>
        </DialogHeader>
        {notice && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        {entry && (
          <EditEntryForm
            key={entry.id}
            entry={entry}
            valueCents={valueCents}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditEntryForm({
  entry,
  valueCents = null,
  onClose,
  onSaved,
}: {
  entry: EditableEntry;
  valueCents?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Time");
  const locale = useLocale() as AppLocale;
  const [pending, startTransition] = useTransition();
  const [day, setDay] = useState(entry.day);
  const [duration, setDuration] = useState(() =>
    formatMinutes(entry.durationMinutes),
  );
  const [note, setNote] = useState(entry.note ?? "");
  const [durationBad, setDurationBad] = useState(false);

  const save = () => {
    const minutes = parseDurationToMinutes(duration);
    if (minutes == null) {
      setDurationBad(true);
      return;
    }
    startTransition(async () => {
      const res = await updateTimeEntryAction({
        entryId: entry.id,
        day,
        durationMinutes: minutes,
        note: note.trim() ? note.trim() : null,
      });
      if (res.ok) {
        toast.success(t("edit_saved"));
        onSaved();
      } else {
        toast.error(
          res.error === "not_allowed" ? t("error_not_allowed") : t("error_generic"),
        );
      }
    });
  };

  return (
    <>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="time-edit-day">{t("log_date")}</Label>
            <Input
              id="time-edit-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="time-edit-duration">{t("log_duration")}</Label>
            <Input
              id="time-edit-duration"
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value);
                setDurationBad(false);
              }}
              placeholder={t("log_duration_placeholder")}
              aria-invalid={durationBad}
            />
            {durationBad && (
              <p className="text-xs text-destructive">
                {t("log_duration_invalid")}
              </p>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="time-edit-note">{t("log_note")}</Label>
          <Textarea
            id="time-edit-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("popover_note_placeholder")}
            rows={2}
          />
        </div>
        {valueCents != null && (
          <p className="text-xs text-muted-foreground">
            {t("entry_value_line", {
              // The shared formatter, viewer's locale — Intl(undefined)
              // formats with the SERVER's locale during SSR.
              amount: formatCurrency(valueCents / 100, locale, {
                fractionDigits: 0,
              }),
            })}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={pending}>
          {t("edit_save")}
        </Button>
      </DialogFooter>
    </>
  );
}
