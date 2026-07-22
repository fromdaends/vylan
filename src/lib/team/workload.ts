// Team Wave 2 — the "who's carrying what" workload roll-up (pure, no I/O).
//
// Given the firm's ACTIVE engagement worklist (already attention-scored by
// loadEngagementWorklist), bucket the rows per assignee so an owner sees each
// teammate's load at a glance: how many active engagements they hold, how many
// are ready for the owner's review, and how many need attention (overdue). Rows
// with no assignee roll into an "unassigned" bucket so unowned work is visible
// rather than lost. Pure so it's unit-tested on its own; the page pairs each
// member's counts with their client count (computed separately).

// The only fields of a WorklistRow this needs. Keeping the input minimal makes
// it trivially testable and decoupled from the (large) WorklistRow shape.
export type WorkloadInputRow = {
  assigneeUserId: string | null;
  readyToReview: boolean;
  daysOverdue: number | null; // null = not overdue
};

export type MemberWorkload = {
  activeEngagements: number;
  readyToReview: number;
  needsAttention: number; // overdue (daysOverdue > 0)
};

function emptyWorkload(): MemberWorkload {
  return { activeEngagements: 0, readyToReview: 0, needsAttention: 0 };
}

// Bucket active engagements by assignee. Returns a per-user map plus the
// unassigned bucket. A user with zero active engagements simply won't appear in
// the map — the caller fills a zero row for every roster member.
export function computeEngagementWorkload(rows: WorkloadInputRow[]): {
  byMember: Record<string, MemberWorkload>;
  unassigned: MemberWorkload;
} {
  const byMember: Record<string, MemberWorkload> = {};
  const unassigned = emptyWorkload();
  for (const r of rows) {
    const bucket = r.assigneeUserId
      ? (byMember[r.assigneeUserId] ??= emptyWorkload())
      : unassigned;
    bucket.activeEngagements += 1;
    if (r.readyToReview) bucket.readyToReview += 1;
    if ((r.daysOverdue ?? 0) > 0) bucket.needsAttention += 1;
  }
  return { byMember, unassigned };
}

// Look up one member's workload, defaulting to zeros so every roster row renders
// (a teammate with nothing active still belongs in the table).
export function workloadForMember(
  byMember: Record<string, MemberWorkload>,
  userId: string,
): MemberWorkload {
  return byMember[userId] ?? emptyWorkload();
}
