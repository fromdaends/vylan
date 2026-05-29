"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock, FileWarning, Search } from "lucide-react";
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
import { selectActive, selectCompleted } from "@/lib/dashboard/worklist-select";
import { cn } from "@/lib/cn";

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
};

const FILTERS = ["recent", "mine", "complete"] as const;
type Filter = (typeof FILTERS)[number];

// Word's "My documents" reimagined as a triage worklist. Recent (default) and
// Mine show active work only; Complete surfaces finished engagements. A
// "Browse all" link still goes to the full /engagements list. Per-engagement
// attention/ready badges render inline; the dedicated "Needs attention" +
// "Ready to review" lists live on /inbox.
export function EngagementsWorklist({
  rows,
  currentUserId,
  locale,
}: {
  rows: WorklistRow[];
  currentUserId: string | null;
  locale: AppLocale;
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
      return selectActive(rows)
        .filter(
          (r) => currentUserId != null && r.assigneeUserId === currentUserId,
        )
        .sort(byRecency);
    }
    // "recent" (default): active work, newest first.
    return selectActive(rows).sort(byRecency);
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
          className="inline-flex items-center gap-1 self-start overflow-x-auto rounded-lg bg-muted p-[3px]"
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
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-foreground/60 hover:text-foreground",
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

      <WorklistTable rows={visible} locale={locale} emptyText={emptyText()} />
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
}: {
  rows: WorklistRow[];
  locale: AppLocale;
  emptyText: string;
}) {
  const t = useTranslations("Dashboard");
  const tStatus = useTranslations("Status");
  const tAttention = useTranslations("Attention");

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
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
}) {
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

  return (
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
        <Badge variant={statusVariant(row.status)} className="font-normal">
          {statusLabel}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
