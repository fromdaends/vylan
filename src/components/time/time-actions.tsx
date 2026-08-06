"use client";

// The two start points, wherever time can be logged: START TIMER and LOG TIME.
//
// One file because they always travel together (engagement page, client
// profile) and share their context props — a second copy on the next surface
// is the drift the cohesion rule exists to stop.
//
// LOG TIME IS A POPOVER, NOT A MODAL. The founder's standing preference, given
// on Add task and honoured here: "it should come from a smaller box that opens
// up near the button kinda like a dropdown."
//
// The CLIENT is fixed by where the button sits — every start point lives on a
// client's own surface, so the dialog states the client rather than asking.
// The engagement is offered as a choice only where the context has more than
// one answer (the client profile); on an engagement page it is simply set.

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseDurationToMinutes } from "@/lib/time/duration";
import { localDay } from "@/lib/time/dates";
import {
  startTimerAction,
  logManualEntryAction,
} from "@/app/actions/time-entries";

export type TimeContext = {
  clientId: string;
  clientName?: string | null;
  engagementId?: string | null;
  taskId?: string | null;
  /** Offered in the Log time form when the context does not pin one. */
  engagementChoices?: { id: string; title: string }[];
};

const NONE = "__none__";

export function StartTimerButton({
  context,
  size = "sm",
}: {
  context: TimeContext;
  size?: "sm" | "default";
}) {
  const t = useTranslations("Time");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const start = () => {
    startTransition(async () => {
      const res = await startTimerAction({
        clientId: context.clientId,
        engagementId: context.engagementId ?? null,
        taskId: context.taskId ?? null,
      });
      if (res.ok) {
        toast.success(t("timer_started"));
        router.refresh();
      } else {
        toast.error(
          res.error === "unsupported" ? t("error_unsupported") : t("error_generic"),
        );
      }
    });
  };

  return (
    <Button size={size} onClick={start} disabled={pending}>
      <Play className="size-3.5" aria-hidden />
      {t("start_timer")}
    </Button>
  );
}

export function LogTimeButton({
  context,
  size = "sm",
}: {
  context: TimeContext;
  size?: "sm" | "default";
}) {
  const t = useTranslations("Time");
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // localDay, NEVER toISOString: UTC's date is tomorrow every Quebec evening.
  const [day, setDay] = useState(() => localDay());
  const [duration, setDuration] = useState("");
  const [durationBad, setDurationBad] = useState(false);
  const [engagementId, setEngagementId] = useState<string>(
    context.engagementId ?? NONE,
  );
  const [note, setNote] = useState("");
  const choices = context.engagementChoices ?? [];
  const askEngagement = !context.engagementId && choices.length > 0;

  const save = () => {
    const minutes = parseDurationToMinutes(duration);
    if (minutes == null) {
      setDurationBad(true);
      return;
    }
    startTransition(async () => {
      const res = await logManualEntryAction({
        clientId: context.clientId,
        engagementId:
          context.engagementId ??
          (engagementId === NONE ? null : engagementId),
        taskId: context.taskId ?? null,
        day,
        durationMinutes: minutes,
        note: note.trim() ? note.trim() : null,
      });
      if (res.ok) {
        toast.success(t("log_saved"));
        setOpen(false);
        setDuration("");
        setNote("");
        router.refresh();
      } else {
        toast.error(
          res.error === "unsupported"
            ? t("error_unsupported")
            : res.error === "invalid"
              ? t("log_duration_invalid")
              : t("error_generic"),
        );
      }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size={size} variant="outline">
          <Plus className="size-3.5" aria-hidden />
          {t("log_time")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-sm font-medium">
          {context.clientName
            ? t("log_title_for", { client: context.clientName })
            : t("log_title")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-day`}>{t("log_date")}</Label>
            <Input
              id={`${uid}-day`}
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-duration`}>{t("log_duration")}</Label>
            <Input
              id={`${uid}-duration`}
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value);
                setDurationBad(false);
              }}
              placeholder={t("log_duration_placeholder")}
              aria-invalid={durationBad}
              autoFocus
            />
            {durationBad && (
              <p className="text-xs text-destructive">
                {t("log_duration_invalid")}
              </p>
            )}
          </div>
        </div>
        {askEngagement && (
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-engagement`}>{t("log_engagement")}</Label>
            <Select value={engagementId} onValueChange={setEngagementId}>
              <SelectTrigger id={`${uid}-engagement`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("log_engagement_none")}</SelectItem>
                {choices.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-note`}>{t("log_note")}</Label>
          <Textarea
            id={`${uid}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("popover_note_placeholder")}
            rows={2}
          />
        </div>
        <Button onClick={save} disabled={pending} size="sm" className="w-full">
          {t("log_save")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
