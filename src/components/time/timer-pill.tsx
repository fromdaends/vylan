"use client";

// The running-timer pill — the one piece of chrome this feature adds.
//
// It lives in the app shell's topBar slot (beside the trial banner when both
// exist), so it is on EVERY page while a timer runs and on none while nothing
// does. The row renders nothing at all without a running entry — no empty bar
// reserving space for a feature that is off.
//
// STATE LIVES ON THE SERVER. The entry is a time_entries row with ended_at
// null, fetched by the layout; this component only ticks the clock forward
// from started_at. A refresh, a second tab or another device all show the same
// timer because they all read the same row — there is no client-side timer to
// lose.
//
// On stop the entry saves immediately and a toast offers Edit — no modal in
// the way (the spec's own words). The edit dialog is HOSTED HERE and stays
// mounted after the pill hides, because the toast's Edit button outlives the
// running state that drew the pill.

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatElapsed, formatMinutes } from "@/lib/time/duration";
import { stopTimerAction } from "@/app/actions/time-entries";
import {
  EditEntryDialog,
  type EditableEntry,
} from "@/components/time/edit-entry-dialog";

export type RunningEntry = {
  id: string;
  startedAt: string;
  clientName: string | null;
  engagementTitle: string | null;
  note: string | null;
};

export function TimerPill({ entry }: { entry: RunningEntry | null }) {
  const t = useTranslations("Time");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(entry?.note ?? "");
  // The toast's Edit target — survives the pill unmounting on stop.
  const [editing, setEditing] = useState<EditableEntry | null>(null);
  // Ticks only after mount so the server render never disagrees with the
  // client's clock (hydration).
  const [elapsed, setElapsed] = useState<number | null>(null);
  const entryId = entry?.id ?? null;
  const startedAt = entry?.startedAt ?? null;
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    // A NEW running entry (switched timers) resets the note draft.
    setNote((prev) => (entryId ? prev : ""));
    if (!startedAt) {
      setElapsed(null);
      return;
    }
    const started = new Date(startedAt).getTime();
    const tick = () => setElapsed((Date.now() - started) / 1000);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [entryId, startedAt]);

  const stop = () => {
    if (!entryId) return;
    startTransition(async () => {
      const res = await stopTimerAction({
        entryId,
        note: noteRef.current.trim() ? noteRef.current.trim() : null,
      });
      if (res.ok) {
        setOpen(false);
        const saved: EditableEntry = {
          id: entryId,
          day: new Date().toISOString().slice(0, 10),
          durationMinutes: res.value.durationMinutes,
          note: noteRef.current.trim() ? noteRef.current.trim() : null,
        };
        toast.success(
          t("entry_saved", {
            duration: formatMinutes(res.value.durationMinutes),
          }),
          {
            action: {
              label: t("entry_saved_edit"),
              onClick: () => setEditing(saved),
            },
          },
        );
        router.refresh();
      } else {
        toast.error(t("error_generic"));
      }
    });
  };

  return (
    <>
      {entry && (
        <div className="pointer-events-none flex justify-end px-4 pt-2 sm:px-6">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1 shadow-sm">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("pill_open_aria")}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full bg-accent motion-safe:animate-pulse"
                  />
                  <span className="font-medium tabular-nums">
                    {elapsed == null ? "" : formatElapsed(elapsed)}
                  </span>
                  {entry.clientName && (
                    <span className="max-w-[180px] truncate text-muted-foreground">
                      {entry.clientName}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {entry.clientName ?? t("popover_title")}
                  </p>
                  {entry.engagementTitle && (
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.engagementTitle}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="timer-note">{t("popover_note_label")}</Label>
                  <Textarea
                    id="timer-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("popover_note_placeholder")}
                    rows={2}
                  />
                </div>
                <Button
                  onClick={stop}
                  disabled={pending}
                  className="w-full"
                  size="sm"
                >
                  {t("pill_stop")}
                </Button>
              </PopoverContent>
            </Popover>
            <Button
              size="icon"
              variant="ghost"
              onClick={stop}
              disabled={pending}
              aria-label={t("pill_stop")}
              className={cn("size-7 rounded-full", pending && "opacity-60")}
            >
              <Square className="size-3.5 fill-current" aria-hidden />
            </Button>
          </div>
        </div>
      )}
      <EditEntryDialog
        entry={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </>
  );
}
