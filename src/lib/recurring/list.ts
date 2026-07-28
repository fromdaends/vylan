// Assembly + triage for the Repeating work screen.
//
// NEUTRAL MODULE — no "use server", no "use client", no I/O. The server page
// and the client toolbar both import it. (Marking a shared module "use client"
// and importing it from a server component is how this repo has 500'd before.)
//
// Everything here is pure so the interesting decisions — what counts as
// "needs attention", what order rows appear in — are unit-testable rather
// than buried in JSX.

import { resolveSeriesAssignee } from "./assignee";
import type { RecurringFrequency, RecurringSeriesStatus } from "./schedule";

// Why a schedule is flagged. Ordered by severity: the first one that applies
// wins, so a row shows the reason that most needs acting on.
//
// The first two are the important ones and neither is visible anywhere else
// in the product today: the SPAWNER auto-pauses a series when its client is
// archived or its checklist snapshot is empty, and it does so silently — no
// activity-log row, no notification. Before this screen, a schedule could stop
// producing work months ago and nobody would find out.
export type AttentionReason =
  | "client_archived"
  | "empty_checklist"
  | "assignee_removed"
  | null;

export type RepeatingRow = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  clientArchived: boolean;
  status: RecurringSeriesStatus;
  frequency: RecurringFrequency;
  intervalMonths: number | null;
  anchorDay: number;
  dueOffsetDays: number;
  nextSpawnOn: string;
  pausedAt: string | null;
  endedAt: string | null;
  documentCount: number;
  sourceEngagementId: string | null;
  // The assignee that will ACTUALLY be used at spawn time, not the raw column
  // — pre-0940 rows carry null when the real answer is the creator, and a
  // deactivated assignee is replaced by an owner. Showing the raw value would
  // lie in both cases.
  assigneeUserId: string | null;
  assigneeName: string | null;
  // The stored assignee is gone. The work still lands somewhere (an owner),
  // but somebody should choose deliberately.
  assigneeWasRemoved: boolean;
  attention: AttentionReason;
};

type SeriesInput = {
  id: string;
  title: string;
  client_id: string;
  status: RecurringSeriesStatus;
  frequency: RecurringFrequency;
  interval_months?: number | null;
  anchor_day: number;
  due_offset_days: number;
  next_spawn_on: string;
  paused_at: string | null;
  ended_at: string | null;
  items: unknown;
  source_engagement_id: string | null;
  assigned_user_id?: string | null;
  created_by_user_id: string | null;
};

type ClientInput = { id: string; display_name: string; archived_at: string | null };
type UserInput = { id: string; name: string; role: "owner" | "staff"; deactivated: boolean };

// Assembles rows from three already-loaded collections. Takes Maps, never a
// fetcher — the page loads clients and users ONCE and this joins in memory, so
// there is no N+1 lurking behind a hundred schedules.
export function buildRepeatingRows(input: {
  series: SeriesInput[];
  clientsById: Map<string, ClientInput>;
  usersById: Map<string, UserInput>;
}): RepeatingRow[] {
  const { series, clientsById, usersById } = input;

  const activeUserIds = new Set(
    [...usersById.values()].filter((u) => !u.deactivated).map((u) => u.id),
  );
  const fallbackOwnerId =
    [...usersById.values()].find((u) => !u.deactivated && u.role === "owner")
      ?.id ?? null;

  return series.map((s) => {
    const client = clientsById.get(s.client_id) ?? null;
    const documentCount = Array.isArray(s.items) ? s.items.length : 0;

    const storedAssignee = s.assigned_user_id ?? s.created_by_user_id ?? null;
    const effectiveAssignee = resolveSeriesAssignee({
      assignedUserId: s.assigned_user_id,
      createdByUserId: s.created_by_user_id,
      activeUserIds,
      fallbackOwnerId,
    });
    const assigneeWasRemoved =
      storedAssignee != null && !activeUserIds.has(storedAssignee);

    return {
      id: s.id,
      title: s.title,
      clientId: s.client_id,
      // A client can be archived but must still resolve a NAME — archived
      // clients are exactly the ones a flagged row is about, so a blank here
      // would hide the problem it exists to show.
      clientName: client?.display_name ?? "",
      clientArchived: client?.archived_at != null,
      status: s.status,
      frequency: s.frequency,
      intervalMonths: s.interval_months ?? null,
      anchorDay: s.anchor_day,
      dueOffsetDays: s.due_offset_days,
      nextSpawnOn: s.next_spawn_on,
      pausedAt: s.paused_at,
      endedAt: s.ended_at,
      documentCount,
      sourceEngagementId: s.source_engagement_id,
      assigneeUserId: effectiveAssignee,
      assigneeName: effectiveAssignee
        ? (usersById.get(effectiveAssignee)?.name ?? null)
        : null,
      assigneeWasRemoved,
      attention: attentionFor({
        status: s.status,
        clientArchived: client?.archived_at != null,
        documentCount,
        assigneeWasRemoved,
      }),
    };
  });
}

// The triage decision, isolated so it can be tested directly.
//
// A STOPPED schedule is never flagged — it was stopped on purpose and will
// never spawn again, so there is nothing to act on.
export function attentionFor(input: {
  status: RecurringSeriesStatus;
  clientArchived: boolean;
  documentCount: number;
  assigneeWasRemoved: boolean;
}): AttentionReason {
  if (input.status === "ended") return null;
  // Severity order. Archived client and empty checklist both mean the spawner
  // has already stopped (or will stop) this schedule; they outrank a staffing
  // question because they stop work being created at all.
  if (input.clientArchived) return "client_archived";
  if (input.documentCount === 0) return "empty_checklist";
  if (input.assigneeWasRemoved) return "assignee_removed";
  return null;
}

// A paused schedule can only be resumed if the thing that stopped it is
// fixed — otherwise the hourly spawner just re-pauses it within the hour, and
// the button becomes a lie. The UI disables Resume and says which one it is.
export function resumeBlockedReason(
  row: Pick<RepeatingRow, "clientArchived" | "documentCount">,
): "client_archived" | "empty_checklist" | null {
  if (row.clientArchived) return "client_archived";
  if (row.documentCount === 0) return "empty_checklist";
  return null;
}

export const STATUS_FILTERS = ["all", "running", "paused", "attention"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function isStatusFilter(v: unknown): v is StatusFilter {
  return typeof v === "string" && (STATUS_FILTERS as readonly string[]).includes(v);
}

// Stopped schedules are excluded from every filter — they live behind their
// own toggle, the way Archived and Deleted engagements do.
export function matchesStatusFilter(
  row: RepeatingRow,
  filter: StatusFilter,
): boolean {
  if (row.status === "ended") return false;
  switch (filter) {
    case "running":
      return row.status === "active";
    case "paused":
      return row.status === "paused";
    case "attention":
      return row.attention !== null;
    case "all":
    default:
      return true;
  }
}

export function countsFor(rows: RepeatingRow[]): {
  all: number;
  running: number;
  paused: number;
  attention: number;
  stopped: number;
} {
  let all = 0, running = 0, paused = 0, attention = 0, stopped = 0;
  for (const r of rows) {
    if (r.status === "ended") { stopped += 1; continue; }
    all += 1;
    if (r.status === "active") running += 1;
    if (r.status === "paused") paused += 1;
    if (r.attention) attention += 1;
  }
  return { all, running, paused, attention, stopped };
}

// Flagged rows first (they are the reason to open this screen), then soonest
// next run, then title so the order is stable rather than whatever the
// database felt like. A paused row has no meaningful date, so it sorts after
// every running one within its group.
export function sortRows(rows: RepeatingRow[]): RepeatingRow[] {
  return [...rows].sort((a, b) => {
    if ((a.attention !== null) !== (b.attention !== null)) {
      return a.attention !== null ? -1 : 1;
    }
    const aDated = a.status === "active";
    const bDated = b.status === "active";
    if (aDated !== bDated) return aDated ? -1 : 1;
    if (aDated && bDated && a.nextSpawnOn !== b.nextSpawnOn) {
      return a.nextSpawnOn < b.nextSpawnOn ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

// In-memory search over the two things a person would type: the schedule's
// name and the client's. Case- and accent-insensitive so "Legare" finds
// "Légaré" — this app is bilingual and half its client names carry accents.
export function matchesSearch(row: RepeatingRow, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return normalize(row.title).includes(q) || normalize(row.clientName).includes(q);
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
