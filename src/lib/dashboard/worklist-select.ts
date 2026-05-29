import type { WorklistRow } from "@/components/dashboard/engagements-worklist";

// Pure selectors for the Inbox triage lists. Kept free of any server imports
// (only a type from the worklist component) so they're trivially unit-testable
// and shared by /inbox without re-deriving the filters inline.

// Engagements that need chasing — any attention reason (overdue, due soon,
// gone quiet), most urgent first. Powers the Inbox "Needs attention" list and
// mirrors the scoring the dashboard used for its old "Needs attention" tab.
export function selectNeedsAttention(rows: WorklistRow[]): WorklistRow[] {
  return rows
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => b.attentionScore - a.attentionScore);
}

// Engagements with every required item in, awaiting the accountant's review —
// freshest first. Powers the Inbox "Ready to review" list.
export function selectReadyToReview(rows: WorklistRow[]): WorklistRow[] {
  return rows
    .filter((r) => r.readyToReview)
    .sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
}

// Active = still in flight (draft / sent / in progress). Completed and
// cancelled engagements drop out of the dashboard worklist and become the
// "Active" view on /engagements; finished work lives under the Completed /
// All filters there instead.
export function selectActive(rows: WorklistRow[]): WorklistRow[] {
  return rows.filter(
    (r) => r.status !== "complete" && r.status !== "cancelled",
  );
}

// Completed = marked done. The /engagements "Completed" filter.
export function selectCompleted(rows: WorklistRow[]): WorklistRow[] {
  return rows.filter((r) => r.status === "complete");
}
