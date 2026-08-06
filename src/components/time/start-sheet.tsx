"use client";

// "What are you working on?" — the ask-on-start sheet, and the ONLY way a
// timer begins (timer v2 doctrine: one global control, no scattered buttons).
//
// PREFILL IS ONE ROUTE READ AT PRESS TIME — the single "detection" the spec
// allows. The dock hands in the ids it parsed from the pathname; this sheet
// resolves them through pickers for everything else. When the prefill is
// right, starting is ONE tap.
//
// A RUNNING TIMER IS NEVER SILENTLY EATEN: starting a second one asks first —
// save the current entry, or discard it. (The server action still auto-saves
// as a race fallback; this sheet is the polite path.)
//
// MANUAL MODE is the same sheet with a date and a duration — the spec's
// "manual entry via the same sheet", used from the Work → Time timesheet.
//
// The FORM is keyed by the dock's open counter: each open remounts it with
// fresh state seeded from props — state-reset-by-key, the repo's React
// Compiler pattern, instead of a re-seeding effect.

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseDurationToMinutes } from "@/lib/time/duration";
import { localDay } from "@/lib/time/dates";
import {
  discardRunningTimerAction,
  listTimePickerDataAction,
  logManualEntryAction,
  startTimerAction,
  stopTimerAction,
} from "@/app/actions/time-entries";

const NONE = "__none__";

export type StartSheetPrefill = {
  clientId: string | null;
  clientName: string | null;
  engagementId: string | null;
  engagementTitle: string | null;
};

export function StartSheet({
  open,
  instanceKey,
  mode,
  prefill,
  runningEntryId,
  runningLabel,
  onClose,
  onStarted,
}: {
  open: boolean;
  /** Bumped by the opener on every open — remounts the form with fresh state. */
  instanceKey: number;
  /** "timer" starts the clock; "manual" logs a finished entry. */
  mode: "timer" | "manual";
  prefill: StartSheetPrefill | null;
  /** The caller's running entry, if any — triggers the save/discard ask. */
  runningEntryId: string | null;
  runningLabel: string | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const t = useTranslations("Time");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === "timer" ? t("sheet_title") : t("log_title")}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <SheetForm
            key={instanceKey}
            mode={mode}
            prefill={prefill}
            runningEntryId={runningEntryId}
            runningLabel={runningLabel}
            onClose={onClose}
            onStarted={onStarted}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SheetForm({
  mode,
  prefill,
  runningEntryId,
  runningLabel,
  onClose,
  onStarted,
}: {
  mode: "timer" | "manual";
  prefill: StartSheetPrefill | null;
  runningEntryId: string | null;
  runningLabel: string | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const t = useTranslations("Time");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [engagements, setEngagements] = useState<
    { id: string; title: string }[]
  >([]);
  const [clientId, setClientId] = useState<string>(
    () => prefill?.clientId ?? NONE,
  );
  const [engagementId, setEngagementId] = useState<string>(
    () => prefill?.engagementId ?? NONE,
  );
  const [day, setDay] = useState(() => localDay());
  const [duration, setDuration] = useState("");
  const [durationBad, setDurationBad] = useState(false);
  const [note, setNote] = useState("");
  // What to do with the running timer: undecided → the ask renders first.
  const [runningDecision, setRunningDecision] = useState<
    "save" | "discard" | null
  >(null);
  const [loaded, setLoaded] = useState(false);

  // Pickers load lazily on mount (= on open, since the form is keyed): the
  // shell never pays for a closed sheet. Async callback setState only.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listTimePickerDataAction({
        clientId: prefill?.clientId ?? null,
      });
      if (cancelled || !res.ok) return;
      setClients(res.value.clients);
      setEngagements(res.value.engagements);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // The form remounts per open; prefill is fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch engagements when the chosen client changes.
  const pickClient = (id: string) => {
    setClientId(id);
    setEngagementId(NONE);
    if (id === NONE) {
      setEngagements([]);
      return;
    }
    void (async () => {
      const res = await listTimePickerDataAction({ clientId: id });
      if (res.ok) setEngagements(res.value.engagements);
    })();
  };

  const needsRunningAsk =
    mode === "timer" && runningEntryId != null && runningDecision == null;

  const start = () => {
    if (clientId === NONE) return;
    const minutes =
      mode === "manual" ? parseDurationToMinutes(duration) : null;
    if (mode === "manual" && minutes == null) {
      setDurationBad(true);
      return;
    }
    startTransition(async () => {
      // Honour the running-timer decision first.
      if (mode === "timer" && runningEntryId && runningDecision === "discard") {
        await discardRunningTimerAction({ entryId: runningEntryId });
      } else if (
        mode === "timer" &&
        runningEntryId &&
        runningDecision === "save"
      ) {
        await stopTimerAction({ entryId: runningEntryId });
      }
      const res =
        mode === "timer"
          ? await startTimerAction({
              clientId,
              engagementId: engagementId === NONE ? null : engagementId,
            })
          : await logManualEntryAction({
              clientId,
              engagementId: engagementId === NONE ? null : engagementId,
              day,
              durationMinutes: minutes ?? 0,
              note: note.trim() ? note.trim() : null,
            });
      if (res.ok) {
        toast.success(mode === "timer" ? t("timer_started") : t("log_saved"));
        onStarted();
        router.refresh();
      } else {
        toast.error(
          res.error === "unsupported" ? t("error_unsupported") : t("error_generic"),
        );
      }
    });
  };

  if (needsRunningAsk) {
    // The save-or-discard ask, before anything else renders — a running
    // timer is a fact to resolve, not a detail to bury under pickers.
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("running_ask", { label: runningLabel ?? t("popover_title") })}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => setRunningDecision("save")}
          >
            {t("running_save")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-destructive hover:text-destructive"
            onClick={() => setRunningDecision("discard")}
          >
            {t("running_discard")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="start-client">{t("sheet_client")}</Label>
        <Select value={clientId} onValueChange={pickClient}>
          <SelectTrigger id="start-client" className="w-full">
            <SelectValue placeholder={t("sheet_client_placeholder")}>
              {clientId === NONE
                ? t("sheet_client_placeholder")
                : clients.find((c) => c.id === clientId)?.name ??
                  prefill?.clientName ??
                  ""}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {!loaded && clientId !== NONE && (
              <SelectItem value={clientId}>
                {prefill?.clientName ?? "…"}
              </SelectItem>
            )}
            {loaded &&
              clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="start-engagement">{t("log_engagement")}</Label>
        <Select
          value={engagementId}
          onValueChange={setEngagementId}
          disabled={clientId === NONE}
        >
          <SelectTrigger id="start-engagement" className="w-full">
            <SelectValue>
              {engagementId === NONE
                ? t("log_engagement_none")
                : engagements.find((e) => e.id === engagementId)?.title ??
                  prefill?.engagementTitle ??
                  ""}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("log_engagement_none")}</SelectItem>
            {engagements.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "manual" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="start-day">{t("log_date")}</Label>
              <Input
                id="start-day"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="start-duration">{t("log_duration")}</Label>
              <Input
                id="start-duration"
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
            <Label htmlFor="start-note">{t("log_note")}</Label>
            <Textarea
              id="start-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("popover_note_placeholder")}
              rows={2}
            />
          </div>
        </>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button onClick={start} disabled={pending || clientId === NONE}>
          {mode === "timer" ? t("sheet_start") : t("log_save")}
        </Button>
      </DialogFooter>
    </div>
  );
}
