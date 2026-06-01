"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock, FileWarning, MoreHorizontal, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, type AppLocale } from "@/lib/format";
import { selectRecent, selectCompleted } from "@/lib/dashboard/worklist-select";
import { cn } from "@/lib/cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useEngagementRowMenu,
  type EngagementLifecycleState,
} from "@/components/engagements/engagement-row-menu";

export type EngagementStatus =
  | "draft"
  | "sent"
  | "in_progress"
  | "complete"
  | "cancelled";

export type WorklistRow = {
  id: string;
  title: string;
  clientName: string;
  status: EngagementStatus;
  dueDate: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  completionPct: number; // 0..1, only meaningful for live engagements
  itemsDone: number;
  itemsTotal: number;
  attentionScore: number;
  reasons: ("overdue" | "due_soon" | "stale")[];
  daysOverdue: number | null;
  daysUntilDue: number | null;
  daysSinceClientActivity: number | null;
  readyToReview: boolean;
  itemsReadyToReview: number;
  // Most recent of (last client upload, sent_at, created_at). Drives the
  // "Recent" sort. ISO 8601, so a lexicographic compare is chronological.
  recencyAt: string;
  // Lifecycle (Phase 2) — drives the row's Archive / Delete / Restore menu.
  // Both null = active; archivedAt set = archived; deletedAt set = in trash.
  archivedAt: string | null;
  deletedAt: string | null;
};

const FILTERS = ["recent", "mine", "complete"] as const;
type Filter = (typeof FILTERS)[number];

// Word's "My documents" reimagined as a triage worklist. Recent (default) and
// Mine show in-flight work plus recently cancelled engagements — a cancel
// doesn't silently vanish; it stays put with its "Cancelled" badge. Complete
// surfaces finished engagements. A "Browse all" link still goes to the full
// /engagements list. Per-engagement attention/ready badges render inline; the
// dedicated "Needs attention" + "Ready to review" lists live on /inbox.
export function EngagementsWorklist({
  rows,
  currentUserId,
  locale,
  canDelete = false,
}: {
  rows: WorklistRow[];
  currentUserId: string | null;
  locale: AppLocale;
  canDelete?: boolean;
}) {
  const t = useTranslations("Dashboard");
  const [filter, setFilter] = useState<Filter>("recent");
  const [query, setQuery] = useState("");

  const byRecency = (a: WorklistRow, b: WorklistRow) =>
    b.recencyAt.localeCompare(a.recencyAt);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    // An active search spans every engagement (any status), so you can always
    // pull up any client by name. Most-recent first so the freshest match leads.
    if (q !== "") {
      return rows
        .filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.clientName.toLowerCase().includes(q),
        )
        .sort(byRecency);
    }

    if (filter === "complete") {
      return selectCompleted(rows).sort(byRecency);
    }
    if (filter === "mine") {
      return selectRecent(rows)
        .filter(
          (r) => currentUserId != null && r.assigneeUserId === currentUserId,
        )
        .sort(byRecency);
    }
    // "recent" (default): in-flight + recently cancelled work, newest first.
    return selectRecent(rows).sort(byRecency);
  }, [rows, filter, q, currentUserId]);

  const pillLabel = (f: Filter): string =>
    f === "mine"
      ? t("wl_filter_mine")
      : f === "complete"
        ? t("wl_filter_complete")
        : t("wl_filter_recent");

  const emptyText = (): string => {
    if (q !== "") return t("wl_empty_search");
    if (filter === "mine") return t("wl_empty_mine");
    if (filter === "complete") return t("wl_empty_completed");
    return t("wl_empty_recent");
  };

  return (
    <section aria-label={t("wl_heading")} className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t("wl_heading")}
        </h2>
        <Link
          href="/engagements"
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          {t("wl_view_all")}
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label={t("wl_filter_label")}
          className="inline-flex items-center gap-5 self-start overflow-x-auto"
        >
          {FILTERS.map((f) => {
            const active = f === filter;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {pillLabel(f)}
              </button>
            );
          })}
        </div>

        <div className="relative sm:w-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("wl_search_placeholder")}
            aria-label={t("wl_search_placeholder")}
            className="h-9 pl-9"
          />
        </div>
      </div>

      <WorklistTable
        rows={visible}
        locale={locale}
        emptyText={emptyText()}
        canDelete={canDelete}
      />
    </section>
  );
}

// Presentational table of worklist rows, shared by the Dashboard worklist and
// the Inbox's "Needs attention" / "Ready to review" sections. Renders the
// dashed empty state when there are no rows.
export function WorklistTable({
  rows,
  locale,
  emptyText,
  canDelete = false,
  countdownFor,
}: {
  rows: WorklistRow[];
  locale: AppLocale;
  emptyText: string;
  canDelete?: boolean;
  // Optional per-row caption (e.g. the Recently Deleted "deleted in N days"
  // countdown). Returns null for rows that shouldn't show one.
  countdownFor?: (row: WorklistRow) => string | null;
}) {
  const t = useTranslations("Dashboard");
  const tStatus = useTranslations("Status");
  const tAttention = useTranslations("Attention");
  const tEng = useTranslations("Engagements");

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 px-5 py-12 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4">{t("wl_col_engagement")}</TableHead>
            <TableHead className="hidden px-4 sm:table-cell">
              {t("wl_col_due")}
            </TableHead>
            <TableHead className="hidden px-4 lg:table-cell">
              {t("wl_col_assigned")}
            </TableHead>
            <TableHead className="hidden px-4 md:table-cell">
              {t("wl_col_progress")}
            </TableHead>
            <TableHead className="px-4">{t("wl_col_status")}</TableHead>
            <TableHead className="w-10 px-2">
              <span className="sr-only">{tEng("menu_actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <WorklistRowView
              key={r.id}
              row={r}
              locale={locale}
              statusLabel={tStatus(r.status)}
              overdueText={
                r.reasons.includes("overdue")
                  ? tAttention("overdue_by", { days: r.daysOverdue ?? 0 })
                  : null
              }
              dueSoonText={
                r.reasons.includes("due_soon")
                  ? tAttention("due_in", { days: r.daysUntilDue ?? 0 })
                  : null
              }
              staleText={
                r.reasons.includes("stale")
                  ? tAttention("stale_days", {
                      days: r.daysSinceClientActivity ?? 0,
                    })
                  : null
              }
              readyText={
                r.readyToReview
                  ? tAttention("items_ready", {
                      count: r.itemsReadyToReview,
                    })
                  : null
              }
              unassignedText={t("wl_unassigned")}
              pctLabel={(pct) => t("wl_pct_complete", { pct })}
              canDelete={canDelete}
              countdownText={countdownFor?.(r) ?? null}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function statusVariant(
  status: EngagementStatus,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "complete") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "draft") return "outline";
  return "secondary";
}

function WorklistRowView({
  row,
  locale,
  statusLabel,
  overdueText,
  dueSoonText,
  staleText,
  readyText,
  unassignedText,
  pctLabel,
  canDelete,
  countdownText,
}: {
  row: WorklistRow;
  locale: AppLocale;
  statusLabel: string;
  overdueText: string | null;
  dueSoonText: string | null;
  staleText: string | null;
  readyText: string | null;
  unassignedText: string;
  pctLabel: (pct: number) => string;
  canDelete: boolean;
  countdownText: string | null;
}) {
  const tEng = useTranslations("Engagements");
  // Completed engagements are 100% by definition; we don't fetch their
  // request items, so trust the status over the (empty) item counts.
  const pct =
    row.status === "complete" ? 100 : Math.round(row.completionPct * 100);
  // Drafts haven't been sent and cancelled work is moot — neither has a
  // meaningful progress bar (and an unfetched-items draft would otherwise
  // read as 100%).
  const showProgress = row.status !== "draft" && row.status !== "cancelled";
  const dueTone = overdueText
    ? "text-destructive"
    : dueSoonText
      ? "text-warning"
      : "text-foreground";

  // Delete wins over archive: a soft-deleted row shows the "deleted" menu even
  // if it was archived first (matches lib/engagements/lifecycle).
  const lifecycleState: EngagementLifecycleState = row.deletedAt
    ? "deleted"
    : row.archivedAt
      ? "archived"
      : "active";
  const { items, dialog } = useEngagementRowMenu({
    engagementId: row.id,
    title: row.title,
    state: lifecycleState,
    canDelete,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TableRow className="relative">
            <TableCell className="px-4 py-3 align-top">
              <Link
                href={`/engagements/${row.id}`}
                className="font-medium text-foreground after:absolute after:inset-0 hover:underline focus-visible:outline-none"
              >
                {row.title}
              </Link>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {row.clientName}
              </div>
              {/* Recently Deleted countdown — how long until the purge cron
                  permanently removes this row. */}
              {countdownText && (
                <div className="mt-1 text-xs font-medium text-destructive">
                  {countdownText}
                </div>
              )}
              {/* Urgency lives in the always-visible Engagement cell (not the
                  Due column, which is hidden on phones) so triage badges never
                  disappear on small screens. */}
              {(overdueText || dueSoonText || staleText || readyText) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {overdueText && (
                    <Badge variant="destructive" className="gap-1 font-normal">
                      <AlertTriangle className="h-3 w-3" />
                      {overdueText}
                    </Badge>
                  )}
                  {dueSoonText && (
                    <Badge variant="secondary" className="gap-1 font-normal">
                      <Clock className="h-3 w-3" />
                      {dueSoonText}
                    </Badge>
                  )}
                  {readyText && (
                    <Badge variant="secondary" className="font-normal">
                      {readyText}
                    </Badge>
                  )}
                  {staleText && (
                    <Badge variant="outline" className="gap-1 font-normal">
                      <FileWarning className="h-3 w-3" />
                      {staleText}
                    </Badge>
                  )}
                </div>
              )}
            </TableCell>

            <TableCell className="hidden px-4 py-3 align-top sm:table-cell">
              <div className={cn("text-sm tabular-nums", dueTone)}>
                {formatDate(row.dueDate, locale, "medium")}
              </div>
            </TableCell>

            <TableCell className="hidden px-4 py-3 align-top text-sm lg:table-cell">
              {row.assigneeName ? (
                <span className="text-foreground">{row.assigneeName}</span>
              ) : (
                <span className="italic text-muted-foreground">
                  {unassignedText}
                </span>
              )}
            </TableCell>

            <TableCell className="hidden px-4 py-3 align-top md:table-cell">
              {!showProgress ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={pctLabel(pct)}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                </div>
              )}
            </TableCell>

            <TableCell className="px-4 py-3 align-top">
              <Badge
                variant={statusVariant(row.status)}
                className="font-normal"
              >
                {statusLabel}
              </Badge>
            </TableCell>

            {/* Actions menu. The "..." button sits above the row's full-row
                link overlay (relative z-10) so a click opens the menu instead
                of navigating; right-clicking anywhere on the row opens the
                same menu via the context-menu wrapper. */}
            <TableCell className="px-2 py-3 align-top">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={tEng("menu_actions")}
                    className="relative z-10 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {items.map((it) => {
                    const Icon = it.icon;
                    return (
                      <DropdownMenuItem
                        key={it.key}
                        variant={it.variant}
                        onSelect={it.onSelect}
                      >
                        <Icon />
                        {it.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <ContextMenuItem
                key={it.key}
                variant={it.variant}
                onSelect={it.onSelect}
              >
                <Icon />
                {it.label}
              </ContextMenuItem>
            );
          })}
        </ContextMenuContent>
      </ContextMenu>
      {dialog}
    </>
  );
}
