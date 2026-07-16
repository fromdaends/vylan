"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clock,
  FileWarning,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { PaymentBadge } from "@/components/payments/payment-badge";
import type { PaymentRequestStatus } from "@/lib/db/payment-requests";
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
import {
  selectRecent,
  selectCompleted,
  selectAssignedTo,
} from "@/lib/dashboard/worklist-select";
import { cn } from "@/lib/cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useEngagementRowMenu,
  type EngagementLifecycleState,
} from "@/components/engagements/engagement-row-menu";
import {
  engagementStatusVariant,
  READY_PILL_CLASS,
} from "@/lib/engagements/status-pill";
import type { EngagementStage } from "@/lib/engagements/stage";
import type { StageSortDir } from "@/lib/engagements/stage-filter";
import { StageChip } from "@/components/engagements/stage-chip";

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
  // The unified display status (deriveEngagementStatus in lib/attention):
  // same as `status` except a live engagement whose checklist puts the ball
  // in the accountant's court reads "ready_to_review". EVERY status pill
  // renders this; `status` stays for lifecycle filtering (complete/cancelled).
  derivedStatus: EngagementStatus | "ready_to_review";
  // Needs attention 2.0 file-level signals (lib/dashboard/action-signals):
  // flagged uploads awaiting the accountant's call, returned signed copies
  // awaiting confirmation, and how long the oldest undecided submission has
  // been waiting (sittingUnreviewed = past the threshold).
  flaggedFilesCount: number;
  signedCopiesToConfirm: number;
  waitingSince: string | null;
  waitingDays: number | null;
  sittingUnreviewed: boolean;
  dueDate: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  // Two-tone display progress (0..1 each, only meaningful for live
  // engagements): approvedPct = required items the accountant APPROVED (the
  // % shown + the solid fill); awaitingPct = required items submitted and
  // awaiting a decision (the dimmer second segment). See lib/attention.
  approvedPct: number;
  awaitingPct: number;
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
  // Latest payment status for this engagement, or null/undefined when no payment
  // was ever requested (payment is optional). Drives the Paid / Unpaid / Failed
  // chip. Optional so callers that don't load payments stay valid.
  paymentStatus?: PaymentRequestStatus | null;
  // Workflow stage (migration 0690) — WHERE this engagement is in the firm's
  // process. Replaces the generic derivedStatus pill in the Status column for
  // live engagements. null/undefined when the engagement has no workflow
  // position (a draft or a cancelled one) OR when 0690 isn't applied yet; the
  // Status column then falls back to the derivedStatus pill exactly as before.
  stage?: EngagementStage | null;
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
  isOwner = false,
  teamEnabled = true,
  locale,
  canDelete = false,
}: {
  rows: WorklistRow[];
  currentUserId: string | null;
  isOwner?: boolean;
  teamEnabled?: boolean;
  locale: AppLocale;
  canDelete?: boolean;
}) {
  const t = useTranslations("Dashboard");
  // Default tab: staff start on THEIR work, owners on the firm-wide Recent
  // view. The choice is remembered per user (localStorage), restored on mount.
  const [filter, setFilterState] = useState<Filter>(
    !teamEnabled || isOwner ? "recent" : "mine",
  );
  useEffect(() => {
    if (!currentUserId) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(`vylan:wl-filter:${currentUserId}`);
    } catch {
      saved = null;
    }
    if (
      saved &&
      (FILTERS as readonly string[]).includes(saved) &&
      (teamEnabled || saved !== "mine")
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilterState(saved as Filter);
    }
  }, [currentUserId, teamEnabled]);
  const setFilter = (f: Filter) => {
    setFilterState(f);
    if (currentUserId) {
      try {
        localStorage.setItem(`vylan:wl-filter:${currentUserId}`, f);
      } catch {
        /* ignore quota / disabled storage */
      }
    }
  };
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
    if (teamEnabled && filter === "mine") {
      return selectAssignedTo(selectRecent(rows), currentUserId).sort(byRecency);
    }
    // "recent" (default): in-flight + recently cancelled work, newest first.
    return selectRecent(rows).sort(byRecency);
  }, [rows, filter, q, currentUserId, teamEnabled]);

  const visibleFilters = teamEnabled
    ? FILTERS
    : FILTERS.filter((f) => f !== "mine");

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
          {visibleFilters.map((f) => {
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
        growNameColumn
        teamEnabled={teamEnabled}
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
  growNameColumn = false,
  teamEnabled = true,
  statusSort = null,
  onStatusSortToggle,
}: {
  rows: WorklistRow[];
  locale: AppLocale;
  emptyText: string;
  canDelete?: boolean;
  // Optional per-row caption (e.g. the Recently Deleted "deleted in N days"
  // countdown). Returns null for rows that shouldn't show one.
  countdownFor?: (row: WorklistRow) => string | null;
  // Stage sorting, opt-in. Passing onStatusSortToggle is what makes the Status
  // header a control at all — without it the header is the plain label every
  // other caller (the Overview, the other sub-pages) has always rendered. This
  // component never sorts: the caller owns the order of `rows` (as it already
  // does for recency), and these props only draw the current state.
  statusSort?: StageSortDir | null;
  onStatusSortToggle?: () => void;
  // On the WIDE Overview (>=1800px viewport) only, let the Engagement (name)
  // column absorb the extra horizontal space so the other columns stay at their
  // natural widths instead of drifting apart. Below 1800px — and on any table
  // that doesn't pass this — the layout is unchanged.
  growNameColumn?: boolean;
  teamEnabled?: boolean;
}) {
  const t = useTranslations("Dashboard");
  const tStatus = useTranslations("Status");
  const tAttention = useTranslations("Attention");
  const tEng = useTranslations("Engagements");
  const tStage = useTranslations("Stage");

  // Optimistic removal: archiving / deleting a row drops it from the list
  // instantly. `removedIds` is a client-only overlay — once the server action
  // revalidates and a fresh `rows` set arrives, that IS the truth, so reset the
  // overlay (render-time prev-prop pattern, not setState-in-effect). A failed
  // action reverts just its own id, so the row reappears.
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [prevRows, setPrevRows] = useState(rows);
  if (prevRows !== rows) {
    setPrevRows(rows);
    if (removedIds.size > 0) setRemovedIds(new Set());
  }
  const visibleRows = removedIds.size
    ? rows.filter((r) => !removedIds.has(r.id))
    : rows;

  const removeRow = (id: string, action: () => Promise<unknown>) => {
    setRemovedIds((prev) => new Set(prev).add(id));
    void action().catch((e) => {
      console.error("[worklist] lifecycle action failed:", e);
      setRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  };

  if (visibleRows.length === 0) {
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
            <TableHead
              className={cn(
                "px-4",
                // Only let the name column go greedy on the WIDE canvas
                // (>=1800px). Below that the table stays exactly as it was, so
                // MacBooks / laptops are byte-identical.
                growNameColumn && "min-[1800px]:w-full",
              )}
            >
              {t("wl_col_engagement")}
            </TableHead>
            <TableHead className="hidden px-4 sm:table-cell">
              {t("wl_col_due")}
            </TableHead>
            {teamEnabled && (
              <TableHead className="hidden px-4 lg:table-cell">
                {t("wl_col_assigned")}
              </TableHead>
            )}
            <TableHead className="hidden px-4 md:table-cell">
              {t("wl_col_progress")}
            </TableHead>
            {/* Sortable ONLY where a caller opts in by passing the toggle (the
                Active engagements view). Everywhere else — the Overview, and
                every other All-Engagements sub-page — the header stays the
                plain label it has always been. */}
            <TableHead
              className="px-4"
              aria-sort={
                !onStatusSortToggle
                  ? undefined
                  : statusSort === "asc"
                    ? "ascending"
                    : statusSort === "desc"
                      ? "descending"
                      : "none"
              }
            >
              {onStatusSortToggle ? (
                <button
                  type="button"
                  onClick={onStatusSortToggle}
                  // Communicates the CURRENT state to assistive tech, which is
                  // what aria-sort is for; the visible arrow does the same job
                  // for everyone else.
                  aria-label={tStage("sort_by_stage")}
                  className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("wl_col_status")}
                  {statusSort === "asc" ? (
                    <ArrowUp className="size-3.5" aria-hidden />
                  ) : statusSort === "desc" ? (
                    <ArrowDown className="size-3.5" aria-hidden />
                  ) : (
                    <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                  )}
                </button>
              ) : (
                t("wl_col_status")
              )}
            </TableHead>
            <TableHead className="w-10 px-2">
              <span className="sr-only">{tEng("menu_actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((r) => (
            <WorklistRowView
              key={r.id}
              row={r}
              locale={locale}
              onOptimisticRemoval={removeRow}
              statusLabel={tStatus(r.derivedStatus)}
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
                // All-approved engagements are ready with 0 items awaiting a
                // decision — the status pill says it; skip a "0 items" badge.
                r.readyToReview && r.itemsReadyToReview > 0
                  ? tAttention("items_ready", {
                      count: r.itemsReadyToReview,
                    })
                  : null
              }
              unassignedText={t("wl_unassigned")}
              pctLabel={(pct) => t("wl_pct_complete", { pct })}
              canDelete={canDelete}
              countdownText={countdownFor?.(r) ?? null}
              teamEnabled={teamEnabled}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
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
  onOptimisticRemoval,
  teamEnabled,
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
  onOptimisticRemoval: (id: string, action: () => Promise<unknown>) => void;
  teamEnabled: boolean;
}) {
  const tEng = useTranslations("Engagements");
  const router = useRouter();
  // Completed engagements are 100% by definition; we don't fetch their
  // request items, so trust the status over the (empty) item counts.
  // Otherwise the % is the APPROVED share of required items; the dimmer
  // second segment is the submitted-awaiting-review share, so "everything's
  // in but not yet cleared" reads at a glance instead of a premature 100%.
  const pct =
    row.status === "complete" ? 100 : Math.round(row.approvedPct * 100);
  const awaitingPctValue =
    row.status === "complete" ? 0 : Math.round(row.awaitingPct * 100);
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
    // Adds the Stage submenu — only for a row that HAS a workflow position.
    // (Needs-attention rows deliberately don't pass this: that list is an
    // action queue, not an engagement manager, and its menu renders no
    // submenus.)
    stage: row.stage,
    runOptimistic: onOptimisticRemoval,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TableRow
            className="cursor-pointer"
            onClick={(e) => {
              // Whole-row click opens the engagement. Skip when the click
              // lands on an interactive child (the title link or the "..."
              // menu button) or while the user is selecting text, so those
              // keep their own behaviour. Plain JS navigation — not a CSS
              // stretched-link — so it works in Safari too (cf. #366).
              const el = e.target as HTMLElement;
              if (el.closest("a, button")) return;
              if (window.getSelection()?.toString()) return;
              router.push(`/engagements/${row.id}`);
            }}
          >
            <TableCell className="px-4 py-3 align-top">
              <Link
                href={`/engagements/${row.id}`}
                className="font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
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
              {(overdueText ||
                dueSoonText ||
                staleText ||
                readyText ||
                (row.paymentStatus && row.paymentStatus !== "canceled")) && (
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
                  {row.paymentStatus && (
                    <PaymentBadge status={row.paymentStatus} />
                  )}
                </div>
              )}
            </TableCell>

            <TableCell className="hidden px-4 py-3 align-top sm:table-cell">
              <div className={cn("text-sm tabular-nums", dueTone)}>
                {formatDate(row.dueDate, locale, "medium")}
              </div>
            </TableCell>

            {teamEnabled && (
              <TableCell className="hidden px-4 py-3 align-top text-sm lg:table-cell">
                {row.assigneeName ? (
                  <span className="text-foreground">{row.assigneeName}</span>
                ) : (
                  <span className="italic text-muted-foreground">
                    {unassignedText}
                  </span>
                )}
              </TableCell>
            )}

            <TableCell className="hidden px-4 py-3 align-top md:table-cell">
              {!showProgress ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-1.5 w-20 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={pctLabel(pct)}
                  >
                    {/* Solid = approved; dim = submitted, awaiting review. */}
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                    <div
                      className="h-full bg-primary/35 transition-all"
                      style={{ width: `${awaitingPctValue}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                </div>
              )}
            </TableCell>

            {/* Status column. A live engagement shows its workflow STAGE —
                real position ("In review", "Awaiting signature") instead of the
                generic "In progress" every live row used to read.

                The stage supersedes the derived "Ready to review" pill here too,
                not just "In progress": the two say overlapping things, and
                keeping the green pill would win on almost every row whose stage
                is in_review, so the stage system would never be visible. Ready
                to review is unchanged everywhere it actually drives work — the
                sidebar bucket, its count badge, and the Inbox queue.

                Everything else (draft / complete / cancelled, or any row before
                migration 0690 lands) keeps the status pill: those have no
                workflow position to show. */}
            <TableCell className="px-4 py-3 align-top">
              {row.stage ? (
                <StageChip stage={row.stage} />
              ) : (
                <Badge
                  variant={engagementStatusVariant(row.derivedStatus)}
                  className={cn(
                    "font-normal",
                    row.derivedStatus === "ready_to_review" && READY_PILL_CLASS,
                  )}
                >
                  {statusLabel}
                </Badge>
              )}
            </TableCell>

            {/* Actions menu. Left-clicking the "..." opens the menu; right-
                clicking anywhere on the row opens the same menu via the
                context-menu wrapper. (The engagement title is the row's link.) */}
            <TableCell className="px-2 py-3 align-top">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={tEng("menu_actions")}
                    className="inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {items.map((it) => {
                    const Icon = it.icon;
                    // A submenu item (the Stage picker) opens a child list
                    // instead of acting on click.
                    if (it.submenu) {
                      return (
                        <DropdownMenuSub key={it.key}>
                          <DropdownMenuSubTrigger>
                            <Icon />
                            {it.label}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-52">
                            {it.submenu.map((sub) => (
                              <DropdownMenuItem
                                key={sub.key}
                                onSelect={sub.onSelect}
                                className="gap-2"
                              >
                                <span
                                  aria-hidden
                                  className={cn(
                                    "size-2 shrink-0 rounded-full",
                                    sub.dotClass,
                                  )}
                                />
                                <span className="flex-1">{sub.label}</span>
                                {sub.checked && (
                                  <Check className="size-3.5 shrink-0 text-muted-foreground" />
                                )}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      );
                    }
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
            if (it.submenu) {
              return (
                <ContextMenuSub key={it.key}>
                  <ContextMenuSubTrigger>
                    <Icon />
                    {it.label}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-52">
                    {it.submenu.map((sub) => (
                      <ContextMenuItem
                        key={sub.key}
                        onSelect={sub.onSelect}
                        className="gap-2"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            sub.dotClass,
                          )}
                        />
                        <span className="flex-1">{sub.label}</span>
                        {sub.checked && (
                          <Check className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              );
            }
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
