"use client";

// THE ONE TIMER CONTROL — docked beside the Chats launcher, on every screen.
//
// Idle: a small round clock button. Pressing it reads the CURRENT ROUTE once
// (the only "detection" the spec allows), resolves it to a client/engagement
// prefill, and opens the ask-on-start sheet. Running: a compact elapsed pill
// with the client's name; click for note + stop, or stop straight from the
// square. Stop saves IMMEDIATELY, then the save sheet opens for corrections —
// crash-safe order, no minute held hostage by an unclosed dialog.
//
// THE SWITCH NUDGE: navigate to a DIFFERENT client's or engagement's page
// mid-timer and a quiet line appears above the pill — "Still on X?" / switch.
// Accepting saves the current entry and starts a new one on the new context,
// so entries stay truthful. Dismissing keeps the attribution and stays quiet
// for that navigation. No polling, no activity tracking — the nudge reads the
// pathname, nothing else.
//
// 12-HOUR SAFETY: the tick notices a forgotten timer and stops it (the server
// clamps the duration to 12h); the save sheet opens saying so.
//
// STATE LIVES ON THE SERVER, as always: the entry is the row with ended_at
// null, fetched by the layout. Refresh, second tab, other device — same timer.

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Square, Timer } from "lucide-react";
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
import {
  getTimeContextAction,
  startTimerAction,
  stopTimerAction,
} from "@/app/actions/time-entries";
import {
  EditEntryDialog,
  type EditableEntry,
} from "@/components/time/edit-entry-dialog";
import { StartSheet, type StartSheetPrefill } from "@/components/time/start-sheet";
import {
  getTimerOpenRequests,
  getTimerServerSnapshot,
  subscribeTimer,
} from "@/components/time/timer-store";
import { TIMER_HIDDEN_ON } from "@/components/assistant/chat-launcher";
import { parseRouteContext } from "@/lib/time/route-context";

export type DockEntry = {
  id: string;
  startedAt: string;
  clientId: string;
  engagementId: string | null;
  clientName: string | null;
  engagementTitle: string | null;
  note: string | null;
};


export function TimerDock({ entry }: { entry: DockEntry | null }) {
  const t = useTranslations("Time");
  const router = useRouter();
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetInstance, setSheetInstance] = useState(0);
  const [prefill, setPrefill] = useState<StartSheetPrefill | null>(null);
  const [saving, setSaving] = useState<
    (EditableEntry & { valueCents: number | null; clamped: boolean }) | null
  >(null);
  const openRequests = useSyncExternalStore(
    subscribeTimer,
    getTimerOpenRequests,
    getTimerServerSnapshot,
  );

  // The chat-panel-header button ends up here: same sheet, same prefill read.
  useEffect(() => {
    if (openRequests === 0) return;
    let cancelled = false;
    void (async () => {
      const ctx = parseRouteContext(window.location.pathname.replace(/^\/(en|fr)(?=\/)/, ""));
      const res = await getTimeContextAction(ctx);
      if (cancelled) return;
      setPrefill(res.ok ? res.value : null);
      setSheetInstance((n) => n + 1);
      setSheetOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [openRequests]);

  const hidden = TIMER_HIDDEN_ON.some((re) => re.test(pathname));
  if (hidden) return null;

  const openSheet = () => {
    const ctx = parseRouteContext(pathname);
    void (async () => {
      const res = await getTimeContextAction(ctx);
      setPrefill(res.ok ? res.value : null);
      setSheetInstance((n) => n + 1);
      setSheetOpen(true);
    })();
  };

  return (
    <>
      <div
        className={cn(
          // Left of the chat launcher, same baseline: the launcher sits at
          // right-4/right-6, so the dock parks one bubble further in.
          "fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-6 right-[4.25rem] sm:right-[5.5rem] z-50",
        )}
      >
        {entry ? (
          <RunningPill
            key={entry.id}
            entry={entry}
            pathname={pathname}
            onSaved={(saved) => {
              setSaving(saved);
              router.refresh();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={openSheet}
            aria-label={t("dock_start_aria")}
            className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Timer className="size-5" aria-hidden />
          </button>
        )}
      </div>

      <StartSheet
        open={sheetOpen}
        instanceKey={sheetInstance}
        mode="timer"
        prefill={prefill}
        runningEntryId={entry?.id ?? null}
        runningLabel={entry?.clientName ?? null}
        onClose={() => setSheetOpen(false)}
        onStarted={() => setSheetOpen(false)}
      />

      <EditEntryDialog
        entry={saving}
        valueCents={saving?.valueCents ?? null}
        notice={saving?.clamped ? t("clamped_notice") : null}
        onClose={() => setSaving(null)}
        onSaved={() => {
          setSaving(null);
          router.refresh();
        }}
      />
    </>
  );
}

function RunningPill({
  entry,
  pathname,
  onSaved,
}: {
  entry: DockEntry;
  pathname: string;
  onSaved: (
    saved: EditableEntry & { valueCents: number | null; clamped: boolean },
  ) => void;
}) {
  const t = useTranslations("Time");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(entry.note ?? "");
  const [now, setNow] = useState<number | null>(null);
  // The switch nudge's resolved target — set asynchronously when the pathname
  // wanders onto a different client/engagement; compared at render time so
  // navigating BACK clears it without an effect.
  const [nudge, setNudge] = useState<{
    path: string;
    label: string;
    clientId: string;
    engagementId: string | null;
  } | null>(null);
  const [dismissedPath, setDismissedPath] = useState<string | null>(null);
  // One-shot guard for the 12h auto-stop — a ref, not state: it is never
  // rendered, and writing state synchronously in an effect is the compiler
  // rule this repo enforces.
  const autoStoppedRef = useRef(false);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const raf = requestAnimationFrame(update);
    const id = window.setInterval(update, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, []);

  // Resolve a nudge target when standing on a different context's page.
  useEffect(() => {
    const ctx = parseRouteContext(pathname);
    const differentClient =
      ctx.clientId != null && ctx.clientId !== entry.clientId;
    const differentEngagement =
      ctx.engagementId != null && ctx.engagementId !== entry.engagementId;
    if (!differentClient && !differentEngagement) return;
    let cancelled = false;
    void (async () => {
      const res = await getTimeContextAction(ctx);
      if (cancelled || !res.ok || !res.value.clientId) return;
      setNudge({
        path: pathname,
        label: res.value.engagementTitle ?? res.value.clientName ?? "",
        clientId: res.value.clientId,
        engagementId: res.value.engagementId,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, entry.clientId, entry.engagementId]);

  const started = new Date(entry.startedAt).getTime();
  const elapsed = now == null ? null : (now - started) / 1000;

  const stop = (after?: () => void) => {
    startTransition(async () => {
      const trimmed = note.trim();
      const res = await stopTimerAction({
        entryId: entry.id,
        note: trimmed ? trimmed : null,
      });
      if (res.ok) {
        setOpen(false);
        onSaved({
          id: entry.id,
          day: res.value.day,
          durationMinutes: res.value.durationMinutes,
          note: trimmed ? trimmed : null,
          valueCents: res.value.valueCents,
          clamped: res.value.clamped,
        });
        toast.success(
          t("entry_saved", {
            duration: formatMinutes(res.value.durationMinutes),
          }),
        );
        after?.();
      } else {
        toast.error(t("error_generic"));
      }
    });
  };

  // THE 12-HOUR SAFETY: noticed by the tick, stopped once, saved clamped —
  // the save sheet then says why. Guarded so it fires a single time.
  useEffect(() => {
    if (autoStoppedRef.current || elapsed == null) return;
    if (elapsed >= 12 * 3600) {
      autoStoppedRef.current = true;
      stop();
    }
    // stop is recreated per render but only elapsed decides firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  const switchTo = (target: NonNullable<typeof nudge>) => {
    stop(() => {
      void (async () => {
        const res = await startTimerAction({
          clientId: target.clientId,
          engagementId: target.engagementId,
        });
        if (res.ok) {
          toast.success(t("timer_started"));
          router.refresh();
        }
      })();
    });
  };

  const showNudge =
    nudge != null && nudge.path === pathname && dismissedPath !== pathname;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {showNudge && (
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-md">
          <span className="max-w-[220px] truncate text-muted-foreground">
            {t("nudge_still_on", { label: entry.clientName ?? "…" })}
          </span>
          <button
            type="button"
            className="font-medium text-accent transition-colors hover:text-accent-hover"
            onClick={() => switchTo(nudge)}
            disabled={pending}
          >
            {t("nudge_switch", { label: nudge.label })}
          </button>
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setDismissedPath(pathname)}
            aria-label={t("nudge_dismiss")}
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1 shadow-md">
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
                <span className="max-w-[140px] truncate text-muted-foreground">
                  {entry.clientName}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-80 space-y-3">
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
              onClick={() => stop()}
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
          onClick={() => stop()}
          disabled={pending}
          aria-label={t("pill_stop")}
          className={cn("size-7 rounded-full", pending && "opacity-60")}
        >
          <Square className="size-3.5 fill-current" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
