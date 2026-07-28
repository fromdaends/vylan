// Who should a newly spawned engagement be assigned to?
//
// Before migration 0940 a series carried no assignee and the spawner
// hardcoded `created_by_user_id`, so a removed teammate kept receiving
// brand-new work every cycle, forever. A series now has its own assignee
// (backfilled from the creator), and this is the pure decision the spawner
// applies on every spawn.
//
// THE FALLBACK MATTERS AS MUCH AS THE PRIMARY. Two ways a series can point at
// someone who is gone: it predates 0940 and its creator has since left, or the
// owner chose "Remove anyway" and skipped the handover. Either way the spawner
// must not mint work for a ghost.
//
// DEFAULT CHOSEN: fall back to an active firm owner rather than leaving it
// unassigned. An owner is accountable for the firm's work and will actually
// see it; unassigned work drifts quietly (it lands in the workload view's
// "Unassigned" row, which nobody is paged about). Swap the last two branches
// if the firm would rather have it land unassigned and be triaged.

export type SeriesAssigneeInput = {
  // recurring_series.assigned_user_id — undefined on a pre-0940 read.
  assignedUserId: string | null | undefined;
  // recurring_series.created_by_user_id — the historical answer, and what the
  // 0940 backfill copies from. Still consulted so a deploy that lands ahead of
  // the SQL behaves identically to before.
  createdByUserId: string | null | undefined;
  // Active (not deactivated) members of the series' firm.
  activeUserIds: ReadonlySet<string>;
  // An active owner of that firm, or null if none could be resolved.
  fallbackOwnerId: string | null;
};

export function resolveSeriesAssignee(input: SeriesAssigneeInput): string | null {
  const { assignedUserId, createdByUserId, activeUserIds, fallbackOwnerId } =
    input;

  // Pre-0940 rows have no assigned_user_id; the creator is the historical
  // answer, so reading through to it keeps deploy-ahead-of-SQL identical.
  // `||` not `??` on purpose: an empty-string id is absent, not a candidate.
  const preferred = assignedUserId || createdByUserId || null;
  if (preferred && activeUserIds.has(preferred)) return preferred;

  // The assignee is gone (or was never set). Hand it to an owner who is here.
  if (fallbackOwnerId && activeUserIds.has(fallbackOwnerId)) {
    return fallbackOwnerId;
  }

  // No active owner resolvable — better unassigned than pointing at a ghost.
  return null;
}
