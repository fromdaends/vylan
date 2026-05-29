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

const FILTERS = ["attention", "recent", "mine", "all"] as const;
type Filter = (typeof FILTERS)[number];

// Word's "My documents" reimagined as a triage worklist. The default pill
// ("Needs attention") preserves the dashboard's attention scoring; the
// other pills slice the same engagement set without losing it.
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
  const tStatus = useTranslations("Status");
  const tAttention = useTranslations("Attention");
  const [filter, setFilter] = useState<Filter>("attention");
  const [query, setQuery] = useState("");

  const attentionCount = useMemo(
    () => rows.filter((r) => r.reasons.length > 0).length,
    [rows],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    // An active search spans every engagement, not just the current pill —
    // from the default "Needs attention" view you should still be able to
    // pull up any client by name. Most-recent first so the freshest match
    // leads.
    if (q !== "") {
      return rows
        .filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.clientName.toLowerCase().includes(q),
        )
        .sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
    }

    const set = rows.slice();
    switch (filter) {
      case "attention":
        return set
          .filter((r) => r.reasons.length > 0)
          .sort((a, b) => b.attentionScore - a.attentionScore);
      case "recent":
        return set.sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
      case "mine":
        return set.filter(
          (r) => currentUserId != null && r.assigneeUserId === currentUserId,
        );
      case "all":
      default:
        // Keep the server order (newest first) for "All".
        return set;
    }
  }, [rows, filter, q, currentUserId]);

  const pillLabel = (f: Filter): string => {
    switch (f) {
      case "attention":
        return tAttention("needs_attention");
      case "recent":
        return t("wl_filter_recent");
      case "mine":
        return t("wl_filter_mine");
      default:
        return t("wl_filter_all");
    }
  };

  const emptyText = (): string => {
    if (q !== "") return t("wl_empty_search");
    switch (filter) {
      case "attention":
        return t("wl_empty_attention");
      case "mine":
        return t("wl_empty_mine");
      case "recent":
        return t("wl_empty_recent");
      default:
        return t("wl_empty_all");
    }
  };

  return (
    <section aria-label={t("wl_heading")} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t("wl_heading")}
        </h2>

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

      <div
        role="tablist"
        aria-label={t("wl_filter_label")}
        className="inline-flex items-center gap-1 self-start overflow-x-auto rounded-lg bg-muted p-[3px]"
      >
        {FILTERS.map((f) => {
          const active = f === filter;
          const showCount = f === "attention" && attentionCount > 0;
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
              {showCount ? (
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                    active
                      ? "bg-warning/15 text-warning"
                      : "bg-foreground/10 text-foreground/70",
                  )}
                >
                  {attentionCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center text-sm text-muted-foreground">
          {emptyText()}
        </div>
      ) : (
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
              {visible.map((r) => (
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
      )}
    </section>
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
        {(staleText || readyText) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
        {overdueText && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {overdueText}
          </div>
        )}
        {dueSoonText && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-warning">
            <Clock className="h-3 w-3" />
            {dueSoonText}
          </div>
        )}
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
