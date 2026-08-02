"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  Repeat,
  Search,
  Users,
  MoreHorizontal,
  Pause,
  Play,
  CircleSlash,
  UserCog,
  ExternalLink,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  countsFor,
  isStatusFilter,
  matchesSearch,
  matchesStatusFilter,
  resumeBlockedReason,
  sortRows,
  STATUS_FILTERS,
  type RepeatingRow,
  type StatusFilter,
} from "@/lib/recurring/list";
import { nextRunLabel, nextRunIsImminent } from "@/lib/recurring/next-run";
import { scheduleSentence } from "@/lib/recurring/summary";
import { ordinalDay } from "@/lib/recurring/day-of-month";
import type { LocalDate } from "@/lib/recurring/schedule";
import {
  reassignSeriesAction,
  seriesControlAction,
} from "@/app/actions/recurring";
import { formatDate, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS_PARAM = "status";
const ASSIGNEE_PARAM = "assignee";

export function RepeatingView({
  rows,
  locale,
  today,
  currentUserId,
  isOwner,
  teamEnabled,
  members,
}: {
  rows: RepeatingRow[];
  locale: AppLocale;
  today: LocalDate;
  currentUserId: string;
  isOwner: boolean;
  teamEnabled: boolean;
  members: { id: string; name: string }[];
}) {
  const t = useTranslations("Repeating");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [showStopped, setShowStopped] = useState(false);
  const [confirmStop, setConfirmStop] = useState<RepeatingRow | null>(null);

  // Replace, not push — the Back button should leave the page rather than
  // walking back through every filter someone tried. Mirrors the engagements
  // and clients toolbars so a filtered URL stays shareable.
  function setParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const rawStatus = searchParams?.get(STATUS_PARAM);
  const status: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : "all";
  const urlAssignee = searchParams?.get(ASSIGNEE_PARAM) ?? null;
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const scope =
    urlAssignee && (urlAssignee === "mine" || memberIds.has(urlAssignee))
      ? urlAssignee
      : "all";

  // Search and the assignee lens apply BEFORE the status counts, so each count
  // is exactly what choosing that chip would reveal — picking one never zeroes
  // the others.
  const scoped = useMemo(() => {
    const wanted = scope === "all" ? null : scope === "mine" ? currentUserId : scope;
    return rows.filter(
      (r) =>
        matchesSearch(r, query) &&
        (wanted === null || r.assigneeUserId === wanted),
    );
  }, [rows, query, scope, currentUserId]);

  const counts = useMemo(() => countsFor(scoped), [scoped]);
  // Does this firm have ANY schedule, before any filter? Drives whether the
  // toolbar exists at all.
  const hasAny = rows.length > 0;
  const visible = useMemo(
    () => sortRows(scoped.filter((r) => matchesStatusFilter(r, status))),
    [scoped, status],
  );
  const stopped = useMemo(
    () => sortRows(scoped.filter((r) => r.status === "ended")),
    [scoped],
  );

  function runControl(row: RepeatingRow, action: "pause" | "resume" | "stop") {
    startTransition(async () => {
      const res = await seriesControlAction({ seriesId: row.id, action });
      if (res.ok) {
        toast.success(
          t(
            action === "pause"
              ? "paused_toast"
              : action === "resume"
                ? "resumed_toast"
                : "stopped_toast",
            { title: row.title },
          ),
        );
        router.refresh();
      } else {
        toast.error(t("control_error"));
      }
      setConfirmStop(null);
    });
  }

  function reassign(row: RepeatingRow, userId: string) {
    startTransition(async () => {
      const res = await reassignSeriesAction({ seriesId: row.id, userId });
      if (res.ok) {
        toast.success(
          t("assignee_toast", {
            title: row.title,
            name: members.find((m) => m.id === userId)?.name ?? "",
          }),
        );
        router.refresh();
      } else {
        toast.error(
          t(res.error === "unavailable" ? "assignee_not_available" : "assignee_error"),
        );
      }
    });
  }

  const chips: { key: StatusFilter; count: number }[] = STATUS_FILTERS.map((k) => ({
    key: k,
    count:
      k === "all"
        ? counts.all
        : k === "running"
          ? counts.running
          : k === "paused"
            ? counts.paused
            : counts.attention,
  }));

  return (
    <div className="space-y-5">
      {/* Heads itself the way the sibling blocks in Settings > Automation do
          (icon + text-sm title + text-xs hint), so it reads as one of them
          rather than a page bolted into a settings tab. The list further down is
          deliberately NOT max-w-xl like those blocks — it's a table, and
          constraining it would crush four columns into a third of the width. */}
      <div className="flex items-start gap-2">
        <Repeat
          className="mt-0.5 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <div>
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Filter chips double as the count display — the number worth seeing is
          also the way to narrow to it, instead of stacking a stats row and a
          filter row on top of each other.

          HIDDEN ENTIRELY when the firm has no schedules at all: chips that all
          read zero, a "who it goes to" picker over nobody and a search box over
          nothing are chrome for data that doesn't exist. They come back the
          moment there is one row. Note this keys off `rows`, not the filtered
          `visible` — filtering down to nothing must KEEP the controls, or you
          can't get back. */}
      {hasAny && (
      <div
        role="tablist"
        aria-label={t("filter_label")}
        className="flex flex-wrap items-center gap-1.5"
      >
        {chips.map(({ key, count }) => {
          const active = status === key;
          const isAttention = key === "attention";
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParams({ [STATUS_PARAM]: key === "all" ? null : key })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-foreground shadow-[inset_0_1px_0_0_var(--color-border)]"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              {t(`filter_${key}`)}
              {count > 0 && (
                <span
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                    isAttention
                      ? "bg-warning/15 text-warning"
                      : "bg-accent/15 text-accent",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      )}

      {hasAny && (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {teamEnabled && (
          <Select
            value={scope}
            onValueChange={(s) =>
              setParams({ [ASSIGNEE_PARAM]: s === "all" ? null : s })
            }
          >
            {/* w-auto, not a fixed rem: French clips a fixed-width trigger. */}
            <SelectTrigger size="sm" className="w-auto self-start" aria-label={t("assignee_filter_label")}>
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder={t("assignee_filter_label")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("assignee_filter_all")}</SelectItem>
              <SelectItem value="mine">{t("assignee_filter_mine")}</SelectItem>
              {members.length > 0 && <SelectSeparator />}
              {members
                .filter((m) => m.id !== currentUserId)
                .map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search_placeholder")}
            aria-label={t("search_placeholder")}
            className="h-9 pl-9"
          />
        </div>
      </div>
      )}

      <section>
        {visible.length === 0 ? (
          <EmptyState
            hasAny={rows.length > 0}
            searching={query.trim() !== ""}
            filtered={status !== "all" || scope !== "all"}
          />
        ) : (
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {visible.map((row) => (
              <ScheduleRow
                key={row.id}
                row={row}
                locale={locale}
                today={today}
                t={t}
                teamEnabled={teamEnabled}
                members={members}
                pending={pending}
                onControl={runControl}
                onReassign={reassign}
                onAskStop={setConfirmStop}
              />
            ))}
          </ul>
        )}

        {stopped.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowStopped((v) => !v)}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {showStopped
                ? t("hide_stopped")
                : t("show_stopped", { count: stopped.length })}
            </button>
            {showStopped && (
              <ul className="mt-2 divide-y divide-border border-t border-border">
                {stopped.map((row) => (
                  <ScheduleRow
                    key={row.id}
                    row={row}
                    locale={locale}
                    today={today}
                    t={t}
                    teamEnabled={teamEnabled}
                    members={members}
                    pending={pending}
                    onControl={runControl}
                    onReassign={reassign}
                    onAskStop={setConfirmStop}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Staff see fewer rows than owners because private clients are filtered
          in the database. Saying so turns a future "the numbers don't match"
          into an explanation. */}
      {!isOwner && (
        <p className="text-xs text-muted-foreground">{t("privacy_note_staff")}</p>
      )}

      <Dialog
        open={confirmStop !== null}
        onOpenChange={(o) => !o && setConfirmStop(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("stop_confirm_title")}</DialogTitle>
            <DialogDescription>
              {t("stop_confirm_body", { title: confirmStop?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmStop(null)}
              disabled={pending}
            >
              {t("stop_cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => confirmStop && runControl(confirmStop, "stop")}
            >
              {t("stop_confirm_button")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScheduleRow({
  row,
  locale,
  today,
  t,
  teamEnabled,
  members,
  pending,
  onControl,
  onReassign,
  onAskStop,
}: {
  row: RepeatingRow;
  locale: AppLocale;
  today: LocalDate;
  t: ReturnType<typeof useTranslations<"Repeating">>;
  teamEnabled: boolean;
  members: { id: string; name: string }[];
  pending: boolean;
  onControl: (row: RepeatingRow, action: "pause" | "resume" | "stop") => void;
  onReassign: (row: RepeatingRow, userId: string) => void;
  onAskStop: (row: RepeatingRow) => void;
}) {
  const next = nextRunLabel({
    nextSpawnOn: row.nextSpawnOn,
    today,
    status: row.status,
  });
  const rhythm = scheduleSentence({
    frequency: row.frequency,
    intervalMonths: row.intervalMonths,
    anchorDay: row.anchorDay,
  });
  const blocked = resumeBlockedReason(row);

  return (
    <li
      className={cn(
        "flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4",
        row.attention && "border-l-2 border-warning/60 -ml-[calc(1rem+2px)] pl-4 sm:-ml-[calc(1.25rem+2px)] sm:pl-5",
      )}
    >
      {/* Schedule + client. The one cell that never collapses, so anything
          critical folds into it at narrow widths. */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {row.title}
          </span>
          {row.attention && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-warning/10 px-2 py-0.5 text-xs text-warning">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {t(`attention_${row.attention}`)}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {row.clientName || t("client_unknown")}
        </p>
      </div>

      <p className="shrink-0 text-sm text-muted-foreground sm:w-48">
        {t(rhythm.key, {
          ...rhythm.params,
          day: ordinalDay(Number(rhythm.params.day), locale),
        })}
      </p>

      {/* What's next — status and next run are the same question, so they
          share one cell. A paused row spends its space explaining itself
          rather than showing a stored date that is usually in the past. */}
      <div className="min-w-0 shrink sm:w-44">
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm tabular-nums",
            nextRunIsImminent(next) ? "text-warning" : "text-foreground",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-block size-1.5 rounded-full",
              row.status === "active"
                ? nextRunIsImminent(next)
                  ? "bg-warning"
                  : "bg-accent"
                : "bg-muted-foreground/40",
            )}
          />
          {next.kind === "on_date"
            ? formatDate(next.date, locale)
            : t(`next_${next.kind}`, {
                days: next.kind === "in_days" ? next.days : 0,
              })}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.status === "paused"
            ? row.clientArchived
              ? t("paused_client_archived")
              : row.documentCount === 0
                ? t("paused_empty_checklist")
                : t("paused_manually")
            : row.status === "ended"
              ? t("stopped_on", { date: formatDate(row.endedAt, locale) })
              : t("next_sub")}
        </p>
      </div>

      {teamEnabled && (
        <div className="min-w-0 shrink sm:w-40">
          {row.assigneeName ? (
            <span className="flex items-center gap-2">
              <AvatarInitials name={row.assigneeName} size={22} />
              <span className="truncate text-sm text-foreground">
                {row.assigneeName}
              </span>
            </span>
          ) : (
            <span className="text-sm italic text-muted-foreground">
              {t("assignee_none")}
            </span>
          )}
          {row.assigneeWasRemoved && (
            <span className="mt-0.5 block text-xs text-warning">
              {t("assignee_removed")}
            </span>
          )}
        </div>
      )}

      <div className="shrink-0 self-start sm:self-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("action_menu", { title: row.title })}
              className="inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {row.status === "active" && (
              <DropdownMenuItem
                disabled={pending}
                onSelect={() => onControl(row, "pause")}
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                {t("action_pause")}
              </DropdownMenuItem>
            )}
            {row.status === "paused" && (
              <DropdownMenuItem
                disabled={pending || blocked !== null}
                onSelect={() => blocked === null && onControl(row, "resume")}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                <span className="flex flex-col">
                  {t("action_resume")}
                  {/* Resuming a schedule the spawner would just re-pause is a
                      dead end — say which blocker it is instead. */}
                  {blocked && (
                    <span className="text-xs text-muted-foreground">
                      {t(`resume_blocked_${blocked}`)}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            )}
            {row.status !== "ended" && (
              <DropdownMenuItem disabled={pending} onSelect={() => onAskStop(row)}>
                <CircleSlash className="h-4 w-4" aria-hidden="true" />
                {t("action_stop")}
              </DropdownMenuItem>
            )}

            {teamEnabled && row.status !== "ended" && members.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <UserCog className="h-4 w-4" aria-hidden="true" />
                    {t("action_reassign")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {t("assignee_change_hint")}
                    </DropdownMenuLabel>
                    {members.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        disabled={pending || m.id === row.assigneeUserId}
                        onSelect={() => onReassign(row, m.id)}
                      >
                        <AvatarInitials name={m.name} size={20} />
                        {m.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/clients/${row.clientId}`}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t("action_open_client")}
              </Link>
            </DropdownMenuItem>
            {/* Only when there is one — source_engagement_id is ON DELETE SET
                NULL, so this genuinely goes missing. Never a dead control. */}
            {row.sourceEngagementId && (
              <DropdownMenuItem asChild>
                <Link href={`/engagements/${row.sourceEngagementId}`}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t("action_open_engagement")}
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

// Most firms have zero schedules, so this is the state people see most. It
// teaches the real three-step path rather than apologising for being empty.
function EmptyState({
  hasAny,
  searching,
  filtered,
}: {
  hasAny: boolean;
  searching: boolean;
  filtered: boolean;
}) {
  const t = useTranslations("Repeating");
  if (searching) {
    return <p className="mt-3 text-sm text-muted-foreground">{t("empty_search")}</p>;
  }
  if (hasAny || filtered) {
    return <p className="mt-3 text-sm text-muted-foreground">{t("empty_filtered")}</p>;
  }
  return (
    <div className="mt-3 max-w-prose space-y-2">
      <p className="text-sm font-medium text-foreground">{t("empty_title")}</p>
      <p className="text-sm text-muted-foreground">{t("empty_body")}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t("empty_step_1")}</li>
        <li>{t("empty_step_2")}</li>
        <li>{t("empty_step_3")}</li>
      </ol>
    </div>
  );
}
