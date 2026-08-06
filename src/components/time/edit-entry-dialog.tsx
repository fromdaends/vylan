"use client";

// Editing one time entry — day, duration, note.
//
// A DIALOG rather than the app's usual anchored popover because its two
// callers have no stable anchor: the stop-toast's Edit button lives in a
// transient toast, and the list rows re-render under an inline edit. Small,
// three fields, no steps.
//
// Duration is typed the way it was logged — "1:30", "1.5", "90m" — through the
// same parser the manual dialog uses. formatMinutes() round-trips through that
// parser ("1h 30m" parses to 90), so opening and saving unchanged is a no-op.

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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

export type EditableEntry = {
  id: string;
  /** YYYY-MM-DD as currently stored (firm-tz day). */
  day: string;
  durationMinutes: number;
  note: string | null;
};

export function EditEntryDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: EditableEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Time");
  const [pending, startTransition] = useTransition();
  const [day, setDay] = useState("");
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");
  const [durationBad, setDurationBad] = useState(false);

  // Re-seed the form whenever a different entry opens.
  useEffect(() => {
    if (!entry) return;
    setDay(entry.day);
    setDuration(formatMinutes(entry.durationMinutes));
    setNote(entry.note ?? "");
    setDurationBad(false);
  }, [entry]);

  const save = () => {
    if (!entry) return;
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
    <Dialog open={entry != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("edit_title")}</DialogTitle>
        </DialogHeader>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending}>
            {t("edit_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
