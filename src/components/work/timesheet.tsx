"use client";

// The weekly timesheet — Karbon's shape on Vylan's data: seven day columns,
// entries as small cards, hours-and-dollars totals per day and for the week.
//
// VALUES ARE PER-ROW OPTIONAL: the server sends valueCents only where the
// viewer's RLS read answered (their own entries, or any with insights.view /
// rates.manage). Totals sum ONLY visible values and say nothing otherwise —
// a partial sum labeled as a total is the one lie this page must not tell.
//
// Manual entry opens the SAME ask-on-start sheet the timer uses, in manual
// mode — one flow, one component (spec + the cohesion rule).

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
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
import { formatDate, formatCurrency, type AppLocale } from "@/lib/format";
import { formatMinutes } from "@/lib/time/duration";
import { deleteTimeEntryAction } from "@/app/actions/time-entries";
import {
  EditEntryDialog,
  type EditableEntry,
} from "@/components/time/edit-entry-dialog";
import { StartSheet } from "@/components/time/start-sheet";

export type TimesheetEntry = {
  id: string;
  userId: string;
  day: string;
  durationMinutes: number;
  note: string | null;
  clientId: string;
  engagementId: string | null;
  clientName: string | null;
  engagementTitle: string | null;
  valueCents: number | null;
};

export function Timesheet({
  title,
  days,
  weekStart,
  prevWeek,
  nextWeek,
  person,
  members,
  currentUserId,
  canManage,
  locale,
  entries,
}: {
  title: string;
  days: string[];
  weekStart: string;
  prevWeek: string;
  nextWeek: string;
  person: string;
  members: { id: string; name: string }[];
  currentUserId: string;
  canManage: boolean;
  locale: AppLocale;
  entries: TimesheetEntry[];
}) {
  const t = useTranslations("Time");
  const router = useRouter();
  const [editing, setEditing] = useState<
    (EditableEntry & { valueCents: number | null }) | null
  >(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInstance, setManualInstance] = useState(0);

  const byDay = new Map<string, TimesheetEntry[]>();
  for (const e of entries) {
    const list = byDay.get(e.day) ?? [];
    list.push(e);
    byDay.set(e.day, list);
  }

  const money = (cents: number) =>
    formatCurrency(cents / 100, locale, { fractionDigits: 0 });

  const weekMinutes = entries.reduce((s, e) => s + e.durationMinutes, 0);
  const visibleValues = entries.filter((e) => e.valueCents != null);
  const weekValue =
    visibleValues.length > 0
      ? visibleValues.reduce((s, e) => s + (e.valueCents ?? 0), 0)
      : null;

  const href = (week: string, p: string) =>
    `/work/time?week=${week}${p === currentUserId ? "" : `&person=${p}`}`;

  const remove = (entry: TimesheetEntry) => {
    void (async () => {
      const res = await deleteTimeEntryAction({
        entryId: entry.id,
        engagementId: entry.engagementId,
        clientId: entry.clientId,
      });
      setConfirmId(null);
      if (res.ok) {
        toast.success(t("list_deleted"));
        router.refresh();
      } else {
        toast.error(
          res.error === "not_allowed" ? t("error_not_allowed") : t("error_generic"),
        );
      }
    })();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="flex items-center gap-2">
          {/* Anyone may look (hours are firm-shared); values follow RLS. */}
          <Select
            value={person}
            onValueChange={(p) => router.push(href(weekStart, p))}
          >
            <SelectTrigger className="w-44" aria-label={t("timesheet_person")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.id === currentUserId ? t("timesheet_me", { name: m.name }) : m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setManualInstance((n) => n + 1);
              setManualOpen(true);
            }}
          >
            <Plus className="size-3.5" aria-hidden />
            {t("log_time")}
          </Button>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="size-8" asChild>
              <Link href={href(prevWeek, person)} aria-label={t("timesheet_prev")}>
                <ChevronLeft className="size-4" aria-hidden />
              </Link>
            </Button>
            <span className="min-w-[7.5rem] text-center text-sm text-muted-foreground">
              {formatDate(weekStart, locale, "compact")} –{" "}
              {formatDate(days[6] ?? weekStart, locale, "compact")}
            </span>
            <Button size="icon" variant="ghost" className="size-8" asChild>
              <Link href={href(nextWeek, person)} aria-label={t("timesheet_next")}>
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Seven columns; wide content scrolls inside its own container. */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[980px] grid-cols-7 gap-2">
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const minutes = list.reduce((s, e) => s + e.durationMinutes, 0);
            const values = list.filter((e) => e.valueCents != null);
            const dayValue =
              values.length > 0
                ? values.reduce((s, e) => s + (e.valueCents ?? 0), 0)
                : null;
            return (
              <div
                key={day}
                className="flex min-h-[220px] flex-col rounded-lg border border-border bg-card"
              >
                <div className="border-b border-border/60 px-2.5 py-1.5">
                  <p className="text-xs font-medium">
                    {formatDate(day, locale, "compact")}
                  </p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {minutes > 0 ? formatMinutes(minutes) : "—"}
                    {dayValue != null && ` · ${money(dayValue)}`}
                  </p>
                </div>
                <div className="flex-1 space-y-1.5 p-1.5">
                  {list.map((entry) => {
                    const mayTouch =
                      canManage || entry.userId === currentUserId;
                    return (
                      <div
                        key={entry.id}
                        className="group rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs"
                      >
                        <p className="truncate font-medium">
                          {entry.clientName ?? "—"}
                        </p>
                        {entry.engagementTitle && (
                          <p className="truncate text-muted-foreground">
                            {entry.engagementTitle}
                          </p>
                        )}
                        {entry.note && (
                          <p className="truncate text-muted-foreground">
                            {entry.note}
                          </p>
                        )}
                        <div className="mt-1 flex items-center justify-between">
                          <span className="tabular-nums text-muted-foreground">
                            {formatMinutes(entry.durationMinutes)}
                            {entry.valueCents != null &&
                              ` · ${money(entry.valueCents)}`}
                          </span>
                          {mayTouch && (
                            <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                aria-label={t("list_edit")}
                                onClick={() =>
                                  setEditing({
                                    id: entry.id,
                                    day: entry.day,
                                    durationMinutes: entry.durationMinutes,
                                    note: entry.note,
                                    valueCents: entry.valueCents,
                                  })
                                }
                              >
                                <Pencil className="size-3" aria-hidden />
                              </Button>
                              <Popover
                                open={confirmId === entry.id}
                                onOpenChange={(o) =>
                                  setConfirmId(o ? entry.id : null)
                                }
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-6 text-muted-foreground hover:text-destructive"
                                    aria-label={t("list_delete")}
                                  >
                                    <Trash2 className="size-3" aria-hidden />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="end"
                                  className="w-56 space-y-2"
                                >
                                  <p className="text-sm">
                                    {t("list_delete_confirm")}
                                  </p>
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setConfirmId(null)}
                                    >
                                      {t("cancel")}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => remove(entry)}
                                    >
                                      {t("list_delete")}
                                    </Button>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p
        className={cn(
          "text-sm text-muted-foreground",
          weekMinutes === 0 && "text-center",
        )}
      >
        {weekMinutes === 0
          ? t("timesheet_empty")
          : t("timesheet_week_total", {
              duration: formatMinutes(weekMinutes),
            }) + (weekValue != null ? ` · ${money(weekValue)}` : "")}
      </p>

      <EditEntryDialog
        entry={editing}
        valueCents={editing?.valueCents ?? null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
      <StartSheet
        open={manualOpen}
        instanceKey={manualInstance}
        mode="manual"
        prefill={null}
        runningEntryId={null}
        runningLabel={null}
        onClose={() => setManualOpen(false)}
        onStarted={() => setManualOpen(false)}
      />
    </div>
  );
}
