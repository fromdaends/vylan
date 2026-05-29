import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import type { EngagementScope } from "@/lib/db/engagements";

// The All-Engagements sub-pages (the left-sidebar "Engagements" section). Each
// view slices the engagement set by lifecycle (archived / deleted) + status.
// Kept as pure config + a pure selector so the routing, the sidebar, and the
// tests all agree on the same definitions.

export type EngagementView =
  | "active"
  | "ready"
  | "drafts"
  | "completed"
  | "archived"
  | "cancelled"
  | "deleted";

export const ENGAGEMENT_VIEWS: EngagementView[] = [
  "active",
  "ready",
  "drafts",
  "completed",
  "archived",
  "cancelled",
  "deleted",
];

// Which DB lifecycle scope a view needs loaded. Most views read the "active"
// set (not archived, not deleted); Archived and Recently Deleted read their
// own scopes. The loader is React.cache'd per scope, so every active-scope view
// + the sidebar badges share one query.
export function scopeForView(view: EngagementView): EngagementScope {
  if (view === "archived") return "archived";
  if (view === "deleted") return "deleted";
  return "active";
}

// i18n key suffixes (under the Engagements namespace) for a view's nav label,
// page title, and empty state — e.g. view_active_label / view_active_title /
// view_active_empty.
export function viewLabelKey(view: EngagementView): string {
  return `view_${view}_label`;
}
export function viewTitleKey(view: EngagementView): string {
  return `view_${view}_title`;
}
export function viewEmptyKey(view: EngagementView): string {
  return `view_${view}_empty`;
}

// Filters a scope-loaded row set down to a single view. The rows passed in must
// already be at scopeForView(view) — this applies the status slice on top.
//   active    → in-flight: draft / sent / in_progress (working list)
//   ready     → readyToReview (all required docs in, awaiting review)
//   drafts    → draft only
//   completed → complete
//   archived  → whatever the archived scope returned (status-agnostic)
//   cancelled → cancelled
//   deleted   → whatever the deleted scope returned (status-agnostic)
export function selectView(
  view: EngagementView,
  rows: WorklistRow[],
): WorklistRow[] {
  switch (view) {
    case "active":
      return rows.filter(
        (r) =>
          r.status === "draft" ||
          r.status === "sent" ||
          r.status === "in_progress",
      );
    case "ready":
      return rows.filter((r) => r.readyToReview);
    case "drafts":
      return rows.filter((r) => r.status === "draft");
    case "completed":
      return rows.filter((r) => r.status === "complete");
    case "cancelled":
      return rows.filter((r) => r.status === "cancelled");
    case "archived":
    case "deleted":
      // Scope already constrained these; show them all (any status).
      return rows;
  }
}

// Sidebar badge counts. Only two views get a badge: Ready to review (your
// action queue) and Recently Deleted (so the trash is visible). Both are
// computed from the already-loaded active / deleted row sets — no extra query.
export function readyToReviewCount(activeRows: WorklistRow[]): number {
  return activeRows.filter((r) => r.readyToReview).length;
}
export function recentlyDeletedCount(deletedRows: WorklistRow[]): number {
  return deletedRows.length;
}
