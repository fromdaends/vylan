"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { EngagementReassignMenu } from "@/components/engagements/engagement-reassign-menu";
import { PresenceFaces } from "@/components/engagements/presence-faces";
import { BulkAssignBar } from "@/components/engagements/bulk-assign-bar";
import {
  EngagementTasksDialog,
  type EngagementTasksPanelData,
} from "@/components/engagements/engagement-tasks-dialog";
import { loadEngagementTasksPanelAction } from "@/app/actions/engagement-tasks";
import { reassignEngagementAction } from "@/app/actions/engagements";
import { EngagementDetailPanel } from "@/components/engagements/engagement-detail-panel";
import { useFirmPresence } from "@/lib/engagements/use-firm-presence";
import {
  groupPresenceByEngagement,
  type PresentPerson,
} from "@/lib/engagements/presence";
import {
  AlertTriangle,
  Check,
  Clock,
  FileWarning,
  MoreHorizontal,
  PanelRight,
  Search,
} from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { PaymentBadge } from "@/components/payments/payment-badge";
import type { EngagementType } from "@/lib/db/templates";
import { SERVICE_LABEL_KEY } from "@/lib/engagements/services";
import { ColumnMenu, type SortState } from "@/components/ui/column-menu";

/**
 * What the headers show before anything has been sorted.
 *
 * ColumnMenu wants a SortState, and "no column is sorted" is not one — a key
 * that matches nothing gives every header its neutral arrows, which is the
 * honest picture: the rows are in the order the page handed them over (newest
 * first), not in any column's order.
 */
const UNSORTED: SortState = { key: "", desc: false };
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
  RowMenuItems,
  CONTEXT_MENU_PARTS,
  DROPDOWN_MENU_PARTS,
} from "@/components/engagements/row-menu-items";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { AgreementChip } from "@/components/engagements/agreement-chip";
import {
  AGREEMENT_STATUSES,
  agreementLabelKey,
  agreementStatusForRow,
  type AgreementStatus,
} from "@/lib/engagements/agreement";
import { RecurringBadge } from "@/components/engagements/recurring-badge";

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
  // Which client's work this is. The name alone cannot scope a list — two
  // clients can share a display name, and a filter that matches on text is a
  // filter that eventually shows someone else's engagements.
  clientId: string;
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
  // TASKS, not documents, since the founder moved progress onto the firm's own
  // work. The field names are unchanged so every caller and test keeps
  // compiling; what they MEAN is now: approvedPct = the share of this job's
  // tasks that are DONE, awaitingPct = the share under way. Renaming them is a
  // separate, mechanical change and not worth folding into a behaviour one.
  //
  // Historical note, still true of attention.ts: approvedPct = required items the accountant APPROVED (the
  // % shown + the solid fill); awaitingPct = required items submitted and
  // awaiting a decision (the dimmer second segment). See lib/attention.
  approvedPct: number;
  awaitingPct: number;
  /** Raw counts behind the bar, so a tooltip can say "3 of 7 tasks done"
   *  rather than only a percentage. */
  tasksDone: number;
  tasksTotal: number;
  /**
   * The SERVICE this engagement delivers — Canopy's "Service items" column.
   *
   * The founder was unsure what separates their Service items from their
   * Engagement items; the difference is breadth. A service is what you sold
   * ("Tax prep", "Monthly bookkeeping"); the engagement items are the specific
   * pieces of work inside it. Vylan already has both under other names — the
   * engagement's TYPE is the service, and its TASKS are the items — so neither
   * column needs new storage, only a name.
   */
  /**
   * The engagement's priced service lines, in proposal order — Canopy's
   * "Service items" and the real answer to "what are we doing for them".
   * Empty on anything created before #1274, which falls back to `type`.
   */
  serviceNames?: string[];
  type?: EngagementType;
  /** When it went to the client; falls back to creation for a draft. */
  startedAt?: string | null;
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
  // Recurring series linkage (migration 0770): non-null when this engagement
  // belongs to a series — renders the compact "Recurring" chip by the title.
  seriesId?: string | null;
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
        viewerId={currentUserId}
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
  reassignMembers,
  assignMembers,
  viewerId,
  firmId,
  presenceRoster,
  bulkAssignMembers,
  countLabel,
  flushTop = false,
}: {
  rows: WorklistRow[];
  locale: AppLocale;
  emptyText: string;
  canDelete?: boolean;
  // Optional per-row caption (e.g. the Recently Deleted "deleted in N days"
  // countdown). Returns null for rows that shouldn't show one.
  countdownFor?: (row: WorklistRow) => string | null;
  // ⚠️ statusSort / onStatusSortToggle are GONE. The Status header used to be
  // an opt-in arrow driven by the page around it, which meant sorting existed
  // on exactly one of the five lists built from this table. Every header is now
  // a menu owned by the table itself, so all five sort the same way. The stage
  // FILTER chips on the engagements page still live in the URL — only the sort
  // moved.
  // On the WIDE Overview (>=1800px viewport) only, let the Engagement (name)
  // column absorb the extra horizontal space so the other columns stay at their
  // natural widths instead of drifting apart. Below 1800px — and on any table
  // that doesn't pass this — the layout is unchanged.
  growNameColumn?: boolean;
  teamEnabled?: boolean;
  // Opt-in per-row "reassign this engagement" menu (the teammate profile passes
  // the list of teammates to hand work to). A plain SERIALIZABLE array — the menu
  // itself is built inside this client component per row, so no function crosses
  // the server→client boundary. When omitted — every other caller — no extra
  // column is rendered, so the Overview + engagement sub-pages are untouched.
  reassignMembers?: { id: string; name: string }[];
  // Assignment targets for the row MENU only — no extra ⇄ column. The main
  // engagements list wants "Assign to…" in the "..." menu without a column
  // of icons on every row; the teammate profile wants both and passes
  // reassignMembers instead, which implies this.
  assignMembers?: { id: string; name: string }[];
  // The signed-in user, so the row menu can offer "Take it". Optional: a caller
  // that does not pass it simply gets the plain list of names, which is what
  // every caller got before.
  viewerId?: string | null;
  // Live presence on the rows: who has each job open right now. ONE channel for
  // the whole table — subscribing per row would mean forty joins on a forty-row
  // page, re-joined on every navigation and every auto-refresh. Both optional,
  // so every caller that passes neither behaves exactly as before.
  firmId?: string | null;
  presenceRoster?: readonly { id: string; name: string }[];
  // Passing this turns on tick-rows-and-reassign. Absent — every caller except
  // the main engagements list — and there is no checkbox column at all, so the
  // Overview, the Inbox and the teammate profile are untouched.
  bulkAssignMembers?: { id: string; name: string }[];
  /**
   * "10 engagements", drawn directly above the header row as Canopy does.
   *
   * ⚠️ IT LIVES HERE, not on the page around the table. The page can only count
   * what it handed over, and the column menus filter INSIDE this component — so
   * a count rendered out there sat at 10 while the table showed 3, which is
   * worse than no count at all. Whoever does the filtering owns the number.
   */
  countLabel?: (count: number) => string;
  /**
   * Drop the table's own top rule because the page already drew one.
   *
   * ⚠️ THE FOUNDER SAW TWO LINES. The engagements page ends its tab row with a
   * rule and this table opens with one, eight pixels apart — which reads as a
   * rendering mistake, because it is one. Explicit rather than inferred from
   * some other prop: a hairline is exactly the kind of thing that goes missing
   * on the three OTHER lists built from this component (the Overview, the
   * Inbox queue, a teammate's profile), none of which has a tab row above it.
   */
  flushTop?: boolean;
}) {
  const t = useTranslations("Dashboard");
  const tStatus = useTranslations("Status");
  const tAttention = useTranslations("Attention");
  const tEng = useTranslations("Engagements");

  // Ticked rows. A Set because the only operations are has/add/delete, and the
  // bar needs the count more than the order.
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulkEnabled = Boolean(bulkAssignMembers?.length);
  // What is ACTUALLY selected: the ticked ids, intersected with the rows on
  // screen right now. DERIVED, not synced with an effect — acting on a row you
  // can no longer see is the classic bulk-action bug and it is silent (the
  // count says 8, three of them were filtered away). Deriving makes that
  // unrepresentable instead of relying on a cleanup running in time.
  //
  // The raw set is deliberately NOT pruned: type into the search box, tick a
  // row, clear the search, and your earlier ticks are still there. Filtering is
  // a view, not a deselection.
  const selectedIds = useMemo(
    () => rows.filter((r) => selected.has(r.id)).map((r) => r.id),
    [rows, selected],
  );

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── THE DETAIL SIDEBAR ────────────────────────────────────────────────────
  // Founder: "you see this sidebar view for tasks. do the same thing for
  // engagements. its lacking." The row NAME opens it and the panel's first
  // control opens the full screen — the same mapping the tasks table uses, so
  // the two lists behave identically rather than each having its own idea of
  // what clicking a name means.
  const [detailId, setDetailId] = useState<string | null>(null);
  // Whoever this table was given for assignment. The main engagements list
  // passes assignMembers; a teammate profile passes reassignMembers. With
  // neither, the panel still OPENS — it just cannot reassign, which is the
  // honest state for a caller that never supplied a roster.
  const detailMembers = assignMembers ?? reassignMembers ?? [];
  // Optimistic assignee, keyed by engagement. Rolled back if the write fails,
  // so the panel never keeps showing a hand-off the server refused.
  const [assignOverride, setAssignOverride] = useState<
    Record<string, { id: string | null; name: string | null }>
  >({});
  const detailRow = useMemo(() => {
    const r = rows.find((x) => x.id === detailId);
    if (!r) return null;
    const o = assignOverride[r.id];
    return o ? { ...r, assigneeUserId: o.id, assigneeName: o.name } : r;
  }, [rows, detailId, assignOverride]);

  // One firm-wide presence subscription for the entire table. onEngagementId is
  // null: a list is not "on" any single job, it only listens. Hooks cannot be
  // conditional, so this always runs — useFirmPresence no-ops on a falsy id,
  // which is what a caller that passes no firmId gets.
  const presenceState = useFirmPresence({
    firmId: firmId ?? "",
    viewerId: viewerId ?? "",
    onEngagementId: null,
  });
  const presenceByEngagement = useMemo(
    () =>
      groupPresenceByEngagement(
        presenceState,
        viewerId ?? "",
        presenceRoster ?? [],
      ),
    [presenceState, viewerId, presenceRoster],
  );

  // ── SORT AND FILTER, PER COLUMN ──────────────────────────────────────────
  //
  // The founder, on this page: "how the tasks looks needs to be similar to how
  // the engagements look and function in a similar process." On the Tasks page
  // every header is a menu — two sort directions, then the column's own values
  // as tick-boxes — and that is what actually made sorting usable there:
  // "sort by client" floats one client's rows to the top of a hundred, while
  // "show me only this client" answers the question.
  //
  // It lives HERE, in the table, rather than in the engagements page around it,
  // so every list built on this component gets it — the Overview, the Inbox
  // queue and a teammate's profile, none of which had any sorting at all.
  //
  // `null` means "the order I was handed", which is the parent's default of
  // newest-first. Nothing sorts until a header is used.
  // The job whose tasks are open, or null. Held here rather than per row so
  // only ONE dialog is ever mounted — a hundred rows each holding their own
  // would mount a hundred.
  const [tasksFor, setTasksFor] = useState<WorklistRow | null>(null);
  const [tasksData, setTasksData] = useState<EngagementTasksPanelData | null>(
    null,
  );
  const [tasksFailed, setTasksFailed] = useState(false);

  /**
   * Open a job's tasks, and fetch them.
   *
   * ⚠️ THE ID CHECK AFTER THE AWAIT is the whole reason this is worth reading.
   * Click one row, close, click another, and both requests are in flight; the
   * first can land second and fill the panel with the wrong job's tasks. So the
   * response is only accepted if the panel is still open on the row that asked
   * for it — which the handler knows, because the click told it.
   */
  const openTasks = (row: WorklistRow) => {
    setTasksFor(row);
    setTasksData(null);
    setTasksFailed(false);
    void loadEngagementTasksPanelAction(row.id)
      .then((res) => {
        setTasksFor((current) => {
          if (current?.id !== row.id) return current;
          if (res.ok) {
            setTasksData({
              tasks: res.tasks as unknown as EngagementTasksPanelData["tasks"],
              members: res.members,
              statuses:
                res.statuses as unknown as EngagementTasksPanelData["statuses"],
              currentUserId: res.currentUserId,
            });
          } else {
            setTasksFailed(true);
          }
          return current;
        });
      })
      .catch(() => {
        setTasksFor((current) => {
          if (current?.id === row.id) setTasksFailed(true);
          return current;
        });
      });
  };
  const [sort, setSort] = useState<SortState | null>(null);
  /** The service, in the one wording the whole app uses for it. */
  const serviceLabelFor = (type: string) =>
    tEng(SERVICE_LABEL_KEY[type as EngagementType] ?? "wl_service_custom");
  /**
   * ⚠️ THE MENU NAMES WHAT THE COLUMN SHOWS — the AGREEMENT status.
   *
   * Founder: "the new statuses dont exist within the filter sorting on the
   * engagements page." Correct, and it was a real incoherence: #1307 moved the
   * Status COLUMN onto the agreement words (Draft / Sent / Active / Complete)
   * and left this menu offering workflow STAGES (Collecting documents,
   * Awaiting payment). You could tick "Awaiting payment" and get back rows
   * whose Status cell read "Active" — a filter for a value that appears
   * nowhere on screen.
   *
   * Same resolver, same label builder, same order as the chip in the cell.
   */
  const stageLabel = (v: string) => tEng(agreementLabelKey(v as AgreementStatus));
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);

  /** The distinct values actually present, so a menu never offers an empty row. */
  const distinct = useMemo(() => {
    const clients = new Map<string, string>();
    const services = new Set<string>();
    const assignees = new Map<string, string>();
    const stages = new Set<string>();
    for (const r of rows) {
      if (r.clientName) clients.set(r.clientName, r.clientName);
      // Offer what the column actually SHOWS: the priced line names when the
      // engagement has them, its type only as the fallback. Offering the type
      // on a row that displays "Monthly bookkeeping" would let you filter by a
      // label that appears nowhere on screen.
      const named = (r.serviceNames ?? []).filter((n) => n.trim() !== "");
      if (named.length > 0) for (const n of named) services.add(n);
      else if (r.type) services.add(r.type);
      // Unassigned is a real answer to "whose is this", and the one people
      // filter for most — it gets a row of its own rather than being absent.
      assignees.set(r.assigneeName ?? "", r.assigneeName ?? "");
      stages.add(agreementStatusForRow(r));
    }
    return {
      clients: [...clients.keys()].sort((a, b) => a.localeCompare(b)),
      services: [...services],
      assignees: [...assignees.keys()].sort((a, b) => a.localeCompare(b)),
      stages: [...stages],
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    let out = rows;
    if (clientFilter.length) {
      out = out.filter((r) => clientFilter.includes(r.clientName));
    }
    if (serviceFilter.length) {
      out = out.filter((r) => {
        const named = (r.serviceNames ?? []).filter((n) => n.trim() !== "");
        return named.length > 0
          ? named.some((n) => serviceFilter.includes(n))
          : Boolean(r.type && serviceFilter.includes(r.type));
      });
    }
    if (assigneeFilter.length) {
      out = out.filter((r) => assigneeFilter.includes(r.assigneeName ?? ""));
    }
    if (stageFilter.length) {
      out = out.filter((r) => stageFilter.includes(agreementStatusForRow(r)));
    }
    if (!sort) return out;

    // localeCompare on the text columns so accented client names land where a
    // French-speaking accountant expects them, not after Z.
    const dir = sort.desc ? -1 : 1;
    const text = (v: string | null | undefined) => v ?? "";
    // A missing date sorts LAST in both directions: "no due date" is not
    // earlier than every date, and burying the dated rows under the undated
    // ones is exactly what a date sort was reached for to avoid.
    const byDate = (a: string | null, b: string | null) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b) * dir;
    };
    return [...out].sort((a, b) => {
      switch (sort.key) {
        case "engagement":
          return text(a.title).localeCompare(text(b.title)) * dir;
        case "client":
          return text(a.clientName).localeCompare(text(b.clientName)) * dir;
        case "service":
          return text(a.type).localeCompare(text(b.type)) * dir;
        case "items":
          // By what is LEFT, not by the share done. "3 of 4" and "30 of 40"
          // are the same percentage and nothing like the same afternoon.
          return (
            (a.tasksTotal - a.tasksDone - (b.tasksTotal - b.tasksDone)) * dir
          );
        case "assignee":
          return (
            text(a.assigneeName).localeCompare(text(b.assigneeName)) * dir
          );
        case "due":
          return byDate(a.dueDate ?? null, b.dueDate ?? null);
        case "started":
          return byDate(a.startedAt ?? null, b.startedAt ?? null);
        case "status":
          // Workflow POSITION, not the alphabet — "In review" belongs after
          // "Collecting" wherever the two letters fall. The stage helper
          // already knows the order and breaks its ties by recency.
          return 0;
        default:
          return 0;
      }
    });
  }, [
    rows,
    sort,
    clientFilter,
    serviceFilter,
    assigneeFilter,
    stageFilter,
  ]);

  // Stage is ordered by its own helper rather than by string comparison, so it
  // is applied after the switch above rather than inside it.
  const sortedRows = useMemo(
    () =>
      sort?.key === "status"
        ? // By AGREEMENT position (draft → sent → accepted → active →
          // complete), not the alphabet and no longer by workflow stage: what
          // you want from a status sort is "what is nearly finished".
          [...filteredRows].sort((a, b) => {
            const d =
              AGREEMENT_STATUSES.indexOf(agreementStatusForRow(a)) -
              AGREEMENT_STATUSES.indexOf(agreementStatusForRow(b));
            return sort.desc ? -d : d;
          })
        : filteredRows,
    [filteredRows, sort],
  );

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
    ? sortedRows.filter((r) => !removedIds.has(r.id))
    : sortedRows;

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

  // ⚠️ NO EARLY RETURN ON AN EMPTY LIST.
  //
  // This used to swap the whole table for a dashed box, which took the column
  // headers with it — and the headers are now the only sort and filter controls
  // there are. The founder caught the same thing on the Tasks page: "when there
  // is no tasks the top sorting bars are gone. They should be there no matter
  // what." Filter down to nothing and the way BACK disappeared with the rows.
  //
  // So the empty message is a row in the table instead, and the headers stay.
  const filtersOn =
    clientFilter.length > 0 ||
    serviceFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    stageFilter.length > 0;
  // Header cells, for the empty row's colSpan: name, client, service, items,
  // due, start, status, and the menu — plus the optional ones.
  const columnCount =
    8 +
    (bulkEnabled ? 1 : 0) +
    (teamEnabled ? 1 : 0) +
    (reassignMembers && reassignMembers.length > 0 ? 1 : 0);

  return (
    <div className={cn(!flushTop && "border-t border-border")}>
      {countLabel && (
        <p className="px-4 py-2.5 text-sm tabular-nums text-muted-foreground">
          {countLabel(visibleRows.length)}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {bulkEnabled && (
              <TableHead className="w-9 pl-4 pr-0">
                <input
                  type="checkbox"
                  aria-label={tEng("bulk_select_all")}
                  checked={rows.length > 0 && selectedIds.length === rows.length}
                  // Some-but-not-all shows the dash state, so "select all" is
                  // honest about what a second click will do.
                  ref={(el) => {
                    if (el) {
                      el.indeterminate =
                        selectedIds.length > 0 &&
                        selectedIds.length < rows.length;
                    }
                  }}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(rows.map((r) => r.id))
                        : new Set(),
                    )
                  }
                  className="size-3.5 cursor-pointer accent-primary align-middle"
                />
              </TableHead>
            )}
            <ColumnMenu
              label={t("wl_col_engagement")}
              t={tEng}
              className={cn(
                "px-4",
                // Only let the name column go greedy on the WIDE canvas
                // (>=1800px). Below that the table stays exactly as it was, so
                // MacBooks / laptops are byte-identical.
                growNameColumn && "min-[1800px]:w-full",
              )}
              sortKey="engagement"
              sort={sort ?? UNSORTED}
              setSort={setSort}
              sortLabels={[tEng("sort_asc"), tEng("sort_desc")]}
            />
            {/* Canopy rules EVERY column, not just the seam before Client —
                the grid is what makes a wide row scannable, because the eye
                tracks a line rather than a gap. */}
            <ColumnMenu
              label={t("wl_col_client")}
              t={tEng}
              className="hidden border-l border-border/60 px-4 lg:table-cell"
              sortKey="client"
              sort={sort ?? UNSORTED}
              setSort={setSort}
              sortLabels={[tEng("sort_asc"), tEng("sort_desc")]}
              selected={clientFilter}
              onChange={setClientFilter}
              options={distinct.clients.map((c) => ({ value: c, label: c }))}
            />
            {/* SERVICE ITEMS in Canopy's words. The founder was unsure what
                separates their Service items from their Engagement items; the
                difference is breadth. The service is what you SOLD — tax prep,
                monthly bookkeeping — and Vylan already stores it as the
                engagement's type. */}
            <ColumnMenu
              label={t("wl_col_service")}
              t={tEng}
              className="hidden border-l border-border/60 px-4 lg:table-cell"
              sortKey="service"
              sort={sort ?? UNSORTED}
              setSort={setSort}
              sortLabels={[tEng("sort_asc"), tEng("sort_desc")]}
              selected={serviceFilter}
              onChange={setServiceFilter}
              options={distinct.services.map((v) => ({
                value: v,
                // A type key needs translating ("t1" → "Personal tax (T1)"); a
                // service line is already the words the accountant typed.
                label: SERVICE_LABEL_KEY[v as EngagementType]
                  ? serviceLabelFor(v)
                  : v,
              }))}
            />
            {/* TASKS — and it is called that because that is what it counts.
                It was briefly "Engagement items", Canopy's name for the priced
                scope lines on an engagement ("Tax Prep Individual Package").
                Vylan has no such thing, so the label described something the
                column did not show. Canopy has since MERGED engagement items
                into service items anyway — their docs: "Engagement Item
                templates have been removed. All Engagement-related
                functionality is now part of Service Items" — so the
                distinction the founder could not pin down is one Canopy
                stopped drawing too. */}
            <ColumnMenu
              label={t("wl_col_items")}
              t={tEng}
              className="hidden border-l border-border/60 px-4 md:table-cell"
              sortKey="items"
              sort={sort ?? UNSORTED}
              setSort={setSort}
              // Worded for what it counts: the fewest things left to do first.
              sortLabels={[tEng("sort_lowest"), tEng("sort_highest")]}
            />
            {teamEnabled && (
              <ColumnMenu
                label={t("wl_col_assigned")}
                t={tEng}
                className="hidden border-l border-border/60 px-4 lg:table-cell"
                sortKey="assignee"
                sort={sort ?? UNSORTED}
                setSort={setSort}
                sortLabels={[tEng("sort_asc"), tEng("sort_desc")]}
                selected={assigneeFilter}
                onChange={setAssigneeFilter}
                options={distinct.assignees.map((name) => ({
                  value: name,
                  // "" is nobody. It is the value people filter for most, so it
                  // gets a name rather than an empty row.
                  label: name || t("wl_unassigned"),
                }))}
              />
            )}
            {/* Sort only: there is nothing to tick in a column of a hundred
                distinct days. */}
            <ColumnMenu
              label={t("wl_col_due")}
              t={tEng}
              className="hidden border-l border-border/60 px-4 sm:table-cell"
              sortKey="due"
              sort={sort ?? UNSORTED}
              setSort={setSort}
              sortLabels={[tEng("sort_earliest"), tEng("sort_latest")]}
            />
            <ColumnMenu
              label={t("wl_col_status")}
              t={tEng}
              className="border-l border-border/60 px-4"
              sortKey="status"
              sort={sort ?? UNSORTED}
              setSort={setSort}
              sortLabels={[tEng("sort_agr_earliest"), tEng("sort_agr_latest")]}
              selected={stageFilter}
              onChange={setStageFilter}
              options={distinct.stages.map((v) => ({
                value: v,
                label: stageLabel(v),
              }))}
            />
            {/* START DATE — when it actually began, which is when it went to
                the client. A draft has not begun, so it shows its creation
                date instead of an empty cell.

                xl only, deliberately. It is reference rather than triage: you
                sort by it once a quarter, you read the due date every day. On a
                laptop the two dates side by side would squeeze the columns that
                earn their place. */}
            <ColumnMenu
              label={t("wl_col_started")}
              t={tEng}
              className="hidden border-l border-border/60 px-4 lg:table-cell"
              sortKey="started"
              sort={sort ?? UNSORTED}
              setSort={setSort}
              sortLabels={[tEng("sort_earliest"), tEng("sort_latest")]}
            />
            {reassignMembers && reassignMembers.length > 0 && (
              <TableHead className="w-10 px-2" />
            )}
            <TableHead className="w-10 px-2">
              <span className="sr-only">{tEng("menu_actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columnCount}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                {filtersOn ? tEng("tasks_none_match") : emptyText}
              </TableCell>
            </TableRow>
          )}
          {visibleRows.map((r) => (
            <WorklistRowView
              key={r.id}
              row={r}
              locale={locale}
              reassignMembers={reassignMembers}
              assignMembers={assignMembers}
              viewerId={viewerId}
              presentPeople={presenceByEngagement.get(r.id)}
              selectable={bulkEnabled}
              selected={selected.has(r.id)}
              onToggleSelected={toggleSelected}
              anySelected={selectedIds.length > 0}
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
              canDelete={canDelete}
              countdownText={countdownFor?.(r) ?? null}
              onOpenTasks={openTasks}
              onOpenDetail={setDetailId}
              teamEnabled={teamEnabled}
            />
          ))}
        </TableBody>
      </Table>

      {/* Floats over the list rather than pushing it down, so ticking a row
          never reflows the thing you are ticking. Renders nothing until
          something is selected. */}
      {bulkEnabled && (
        <BulkAssignBar
          selectedIds={selectedIds}
          members={bulkAssignMembers ?? []}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}

      {/* ONE dialog for the whole table, fed by whichever row was clicked.
          Stays mounted while closing so the panel fades rather than vanishing;
          `tasksFor` is only cleared by the close handler. */}
      <EngagementTasksDialog
        engagementId={tasksFor?.id ?? null}
        engagementTitle={tasksFor?.title ?? ""}
        clientName={tasksFor?.clientName}
        data={tasksData}
        failed={tasksFailed}
        open={tasksFor !== null}
        onOpenChange={(next) => {
          if (!next) setTasksFor(null);
        }}
      />

      {/* ONE panel for the whole table, fed by whichever row was clicked —
          the same shape as the tasks dialog above it. */}
      <EngagementDetailPanel
        row={detailRow}
        members={detailMembers}
        canEdit={detailMembers.length > 0}
        locale={locale}
        onClose={() => setDetailId(null)}
        onReassign={(assigneeId) => {
          if (!detailRow) return;
          const id = detailRow.id;
          const name = assigneeId
            ? (detailMembers.find((m) => m.id === assigneeId)?.name ?? null)
            : null;
          setAssignOverride((p) => ({ ...p, [id]: { id: assigneeId, name } }));
          void reassignEngagementAction(id, assigneeId).then((res) => {
            if (res.ok) {
              router.refresh();
              return;
            }
            // Roll the optimistic value back. A panel that keeps showing a
            // hand-off the server refused is worse than one that never moved.
            setAssignOverride((p) => {
              const next = { ...p };
              delete next[id];
              return next;
            });
          });
        }}
      />
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
  canDelete,
  countdownText,
  onOpenTasks,
  onOpenDetail,
  onOptimisticRemoval,
  teamEnabled,
  reassignMembers,
  assignMembers,
  viewerId,
  presentPeople,
  selectable = false,
  selected = false,
  onToggleSelected,
  anySelected = false,
}: {
  row: WorklistRow;
  locale: AppLocale;
  statusLabel: string;
  overdueText: string | null;
  dueSoonText: string | null;
  staleText: string | null;
  readyText: string | null;
  unassignedText: string;
  canDelete: boolean;
  countdownText: string | null;
  /** Opens this job's tasks in a panel. Absent ⇒ the count is inert. */
  onOpenTasks?: (row: WorklistRow) => void;
  /** Opens the detail sidebar for this row. Absent = the name stays a plain
   *  link to the engagement, so a caller that never wired the panel does not
   *  end up with a name that clicks and does nothing. */
  onOpenDetail?: (id: string) => void;
  onOptimisticRemoval: (id: string, action: () => Promise<unknown>) => void;
  teamEnabled: boolean;
  reassignMembers?: { id: string; name: string }[];
  assignMembers?: { id: string; name: string }[];
  viewerId?: string | null;
  // Who has this job open right now. Undefined on the rows nobody is in, which
  // is nearly all of them — so this usually costs the row nothing.
  presentPeople?: PresentPerson[];
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
  // Once anything is ticked, every checkbox stays visible — otherwise you are
  // hunting for hover targets while mid-selection.
  anySelected?: boolean;
}) {
  const tEng = useTranslations("Engagements");
  // One shared map (lib/engagements/services.ts) so a second surface showing
  // the service cannot invent its own wording for the same four things.
  const serviceLabel = (type: EngagementType) => tEng(SERVICE_LABEL_KEY[type]);
  // Named lines only; an unnamed one is a draft the accountant has not filled
  // in, and a blank in a list of services is worse than one fewer.
  const services = (row.serviceNames ?? []).filter((n) => n.trim() !== "");
  const moreServicesText = (count: number) =>
    tEng("wl_service_more", { count: String(count) });
  const router = useRouter();
  // Completed engagements are 100% by definition; we don't fetch their
  // request items, so trust the status over the (empty) item counts.
  // The fallback for a row whose task counts have not landed: the approved
  // share of its required items. `awaitingPct` fed the bar's dim second
  // segment and has no reader now the bar is gone — it stays on the row type
  // because the loader still computes it and the Overview may want it back.
  const pct =
    row.status === "complete" ? 100 : Math.round(row.approvedPct * 100);
  // A job with no tasks yet has nothing to measure. It reads "—" rather than a
  // 0% bar, which would say "started and got nowhere" about work nobody has
  // planned. Drafts and cancelled work stay out for the same reason.
  const showProgress =
    row.status !== "draft" && row.status !== "cancelled" && row.tasksTotal > 0;
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
    // Right-click "Add a comment" (team mode) — deep-links into the
    // engagement's comment composer.
    commentable: teamEnabled,
    // Assign straight from the row. reassignMembers is already threaded here for
    // the per-row control, so the menu costs nothing extra — and it works on the
    // main worklist, where the per-row control isn't shown.
    // Whichever feed the caller gave: reassignMembers (which also draws the ⇄
    // column) or assignMembers (menu only).
    assignees: teamEnabled ? (reassignMembers ?? assignMembers) : undefined,
    assigneeId: row.assigneeUserId,
    viewerId,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <TableRow
            className="group/row cursor-pointer"
            onClick={(e) => {
              // WHOLE-ROW CLICK OPENS THE PANEL, matching the tasks list.
              //
              // This INVERTS #1311, which had the row navigate and hid the
              // panel behind a hover-revealed icon. The founder: "make opening
              // the sidebar for engagements the same as tasks. Instead of
              // having to click that tiny ass button." A 14px target that only
              // appears on hover is not the way to reach the primary view of a
              // row, and the tasks list had already proved the better shape.
              //
              // The TITLE stays a real link to the full page, so the two remain
              // different actions — but the big target is now the common one,
              // and cmd-click on the title still opens the engagement in a new
              // tab, which a button could never do.
              //
              // Plain JS — not a CSS stretched-link — so it works in Safari
              // too (cf. #366).
              const el = e.target as HTMLElement;
              if (el.closest("a, button, input")) return;
              if (window.getSelection()?.toString()) return;
              onOpenDetail?.(row.id);
            }}
          >
            {selectable && (
              <TableCell className="w-9 py-3 pl-4 pr-0 align-middle">
                <input
                  type="checkbox"
                  aria-label={tEng("bulk_select_row")}
                  checked={selected}
                  onChange={() => onToggleSelected?.(row.id)}
                  // Hidden until you hover the row — and pinned visible once
                  // ANYTHING is ticked, so you are not hunting hover targets
                  // mid-selection. A permanent column of empty boxes over an
                  // untouched list is exactly the kind of always-on control
                  // this app avoids.
                  className={cn(
                    "size-3.5 cursor-pointer accent-primary transition-opacity",
                    selected || anySelected
                      ? "opacity-100"
                      : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
                  )}
                />
              </TableCell>
            )}
            <TableCell className="px-4 py-3 align-middle">
              <div className="flex min-w-0 items-center gap-1.5">
                <Link
                  href={`/engagements/${row.id}`}
                  // Canopy renders both name columns as links, in blue. Ours
                  // were links already but painted like plain text, so the one
                  // thing on the row you are meant to click did not look it.
                  className="truncate font-medium text-accent hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {row.title}
                </Link>
                {/* ⚠️ INLINE, AND NOT WRAPPING — this is what makes every row the same
                    height. The founder: "tasks regardless of the size of text or wtv
                    its all the same size for each block consistently. Wheras
                    engagement it differs. MAKE IT CONSISTENT FOR EVERY
                    ENGAGEMENT." These badges used to sit BELOW the title in a
                    flex-wrap row, so a row with two of them was ~25px taller
                    than one with none and the list looked ragged.
                    They now ride the title line, shrink-0 so they are never
                    squashed, with the title truncating instead. Urgency still
                    lives in the always-visible Engagement cell (not the Due
                    column, which is hidden on phones) so triage badges never
                    disappear on small screens. (not the
                    Due column, which is hidden on phones) so triage badges never
                    disappear on small screens. */}
                {(overdueText ||
                  dueSoonText ||
                  staleText ||
                  readyText ||
                  (row.paymentStatus && row.paymentStatus !== "canceled")) && (
                  <span className="flex shrink-0 items-center gap-1.5">
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
                  </span>
                )}
                {/* ⚠️ THE PANEL GETS ITS OWN CONTROL — the NAME KEEPS NAVIGATING.
                    The tasks table maps name→panel, chevron→screen, and copying
                    that here looked right until the tests said otherwise: on
                    THIS list the whole ROW already opens the engagement
                    ("clicking anywhere on a row opens that engagement"). Making
                    the title open a drawer would mean clicking the title and
                    clicking two pixels to the right of it did different things
                    — the row would be arguing with itself.
                    So the mapping inverts relative to tasks, for a reason that
                    only exists here, and every existing navigation path is
                    untouched. Hover-revealed, like the row's tick-box: the
                    founder's standing preference is that a control which is not
                    always needed is not always shown. */}
                {row.seriesId && (
                  <RecurringBadge label={tEng("repeat_badge")} compact />
                )}
                {/* Live: who has this open right now, without opening it.
                    Compact — smaller faces, no pulsing dot. A dot per row on a
                    forty-row list would be a disco; the faces are already
                    unusual enough on a list to catch the eye. */}
                {presentPeople && presentPeople.length > 0 && (
                  <PresenceFaces people={presentPeople} compact />
                )}
              </div>
              {/* lg:hidden — above that width the Client column shows it, and
                  printing the same name twice on one row is just noise. Below
                  it the column is gone, so this is the only place it appears. */}
              <div className="mt-0.5 truncate text-xs text-muted-foreground lg:hidden">
                {row.clientName}
              </div>
              {/* Recently Deleted countdown — how long until the purge cron
                  permanently removes this row. */}
              {countdownText && (
                <div className="mt-1 text-xs font-medium text-destructive">
                  {countdownText}
                </div>
              )}
            </TableCell>

            {/* CLIENT — behind the same divider as the header, and a link,
                because "whose is this" is a question you answer by GOING there.
                The row's own click handler bails on any <a>, so this does not
                fight it. */}
            <TableCell className="hidden border-l border-border/60 px-4 py-3 align-middle text-sm lg:table-cell">
              {row.clientId ? (
                <Link
                  href={`/clients/${row.clientId}`}
                  className="text-accent hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {row.clientName}
                </Link>
              ) : (
                <span className="text-foreground">{row.clientName}</span>
              )}
            </TableCell>

            {/* SERVICE ITEMS — what was sold. Quiet by design: it repeats down
                the column, so it must not compete with the engagement's name. */}
            {/* SERVICE ITEMS — the engagement's priced lines, which is what
                Canopy shows here ("Bookkeeping Monthly", "Tax Prep, Payroll").

                Two shown, then "+N more" exactly as Canopy does: the column has
                to stay one line tall or a row with five services makes every
                other row on screen taller for nothing. The full list is on the
                engagement itself.

                An engagement with no priced lines falls back to its TYPE, which
                is every engagement made before #1274. That fallback is why the
                column reads "Custom" on most existing rows — four fixed values
                cannot describe a real firm's services, which is the whole
                reason the priced lines exist. */}
            <TableCell className="hidden border-l border-border/60 px-4 py-3 align-middle text-sm lg:table-cell">
              {services.length > 0 ? (
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-foreground">
                    {services.slice(0, 2).join(", ")}
                  </span>
                  {services.length > 2 && (
                    <span className="text-xs text-muted-foreground">
                      {moreServicesText(services.length - 2)}
                    </span>
                  )}
                </div>
              ) : row.type ? (
                serviceLabel(row.type)
              ) : (
                "—"
              )}
            </TableCell>

            <TableCell className="hidden border-l border-border/60 px-4 py-3 align-middle md:table-cell">
              {/* ⚠️ THE BAR CAME OUT. Canopy's Engagement items column is a
                  VALUE, not a gauge, and the founder asked for its UI exactly.

                  The bar was also saying the same thing twice: "2/5" is the
                  share AND the amount left, and only the number can tell you
                  the difference between three tasks to go and thirty. What the
                  bar added was a second thing to read in a column that already
                  answered the question. */}
              {!showProgress ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                // THE COUNT OPENS THE TASKS. Founder, on Canopy: "click on the
                // tasks like ex: 3/4 and it brings up a screen of all those
                // tasks for that specific engagement."
                //
                // A button, not a link: the row's own click handler already
                // bails on any <a>/<button>, so this does not fight it, and the
                // panel is not a place you navigate to and come back from.
                // Underline on hover so it reads as something you can press —
                // a bare number gives you no reason to try.
                <button
                  type="button"
                  onClick={() => onOpenTasks?.(row)}
                  disabled={!onOpenTasks}
                  className="-mx-1 rounded px-1 text-sm tabular-nums text-foreground transition-colors hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:no-underline disabled:hover:text-foreground"
                >
                  {row.tasksTotal > 0
                    ? `${row.tasksDone}/${row.tasksTotal}`
                    : `${pct}%`}
                </button>
              )}
            </TableCell>

            {teamEnabled && (
              <TableCell className="hidden border-l border-border/60 px-4 py-3 align-middle text-sm lg:table-cell">
                {/* A person is a place. This name is where you actually think
                    "what else is she on?", so it has to be the way there —
                    until now nobody in the app was clickable, and the only
                    route to a teammate was through Settings. The row's own
                    click handler bails on any <a>, so this doesn't fight it. */}
                {row.assigneeName && row.assigneeUserId ? (
                  <Link
                    href={`/settings/team/${row.assigneeUserId}`}
                    className="text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {row.assigneeName}
                  </Link>
                ) : row.assigneeName ? (
                  <span className="text-foreground">{row.assigneeName}</span>
                ) : (
                  // An em dash, as Canopy does — "Unassigned" in a column of
                  // names reads as somebody's name for the length of a glance.
                  //
                  // The word stays for screen readers: a lone dash announced
                  // aloud is not "nobody", it is nothing at all.
                  <span className="text-muted-foreground">
                    <span className="sr-only">{unassignedText}</span>
                    <span aria-hidden>—</span>
                  </span>
                )}
              </TableCell>
            )}

            <TableCell className="hidden border-l border-border/60 px-4 py-3 align-middle sm:table-cell">
              <div className={cn("text-sm tabular-nums", dueTone)}>
                {formatDate(row.dueDate, locale, "medium")}
              </div>
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
            <TableCell
              // A stable hook for the tests. Status has now moved twice, and a
              // helper that counted cells from the end broke silently both
              // times — a positional assertion is really a test of the column
              // order dressed up as a test of the pill.
              data-column="status"
              className="border-l border-border/60 px-4 py-3 align-middle"
            >
              {/* The AGREEMENT, not the workflow. The stage pill answered a
                  question the engagement can no longer answer once it holds six
                  parallel things — one signature task made the whole row read
                  "Awaiting signature" while four others were in flight. The
                  WORK is the Tasks column beside this, which already reads
                  "1/2".

                  No fallback branch any more. The old chip only rendered when a
                  stage had been resolved and dropped to a raw status pill
                  otherwise; the agreement status is derivable for every row, so
                  the column can no longer be empty or inconsistent. */}
              <AgreementChip status={agreementStatusForRow(row)} />
            </TableCell>

            {/* Opt-in reassign menu (the teammate profile passes the teammates
                to hand work to). Built here inside the client component so no
                function crosses the server→client boundary. */}
            <TableCell className="hidden border-l border-border/60 px-4 py-3 align-middle lg:table-cell">
              <div className="text-sm tabular-nums text-muted-foreground">
                {row.startedAt ? formatDate(row.startedAt, locale, "medium") : "—"}
              </div>
            </TableCell>

            {reassignMembers && reassignMembers.length > 0 && (
              <TableCell className="px-2 py-3 align-middle">
                <EngagementReassignMenu
                  engagementId={row.id}
                  members={reassignMembers}
                />
              </TableCell>
            )}

            {/* Actions menu. Left-clicking the "..." opens the menu; right-
                clicking anywhere on the row opens the same menu via the
                context-menu wrapper. (The engagement title is the row's link.) */}
            <TableCell className="px-2 py-3 align-middle">
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
                  <RowMenuItems items={items} parts={DROPDOWN_MENU_PARTS} />
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          {/* ONE renderer, shared with the tasks list. It used to be pasted
              here and again in the dropdown above, which is why tasks could
              not be given "the same UI" without a third copy. */}
          <RowMenuItems items={items} parts={CONTEXT_MENU_PARTS} />
        </ContextMenuContent>
      </ContextMenu>
      {dialog}
    </>
  );
}
