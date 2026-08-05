import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import type { EngagementScope } from "@/lib/db/engagements";

// The All-Engagements sub-pages (the left-sidebar "Engagements" section). Each
// view slices the engagement set by lifecycle (archived / deleted) + status.
// Kept as pure config + a pure selector so the routing, the sidebar, and the
// tests all agree on the same definitions.

// There is deliberately no "cancelled" view. Cancelling an engagement stopped
// being reachable from the UI when the Cancel item was dropped from the
// engagement menu (Delete already covers removing one), so the tab could only
// ever be empty. The 'cancelled' STATUS still exists in the database and is
// still honoured everywhere it matters (the portal refuses a cancelled
// engagement, the detail page renders read-only), and any legacy cancelled row
// is still findable through the command palette — it just has no tab of its own.
export type EngagementView =
  | "active"
  | "all"
  | "ready"
  | "drafts"
  | "completed"
  | "archived"
  | "deleted";

/** Every view that has a route. NOT what the tab strip shows — see TAB_VIEWS. */
export const ENGAGEMENT_VIEWS: EngagementView[] = [
  "active",
  "all",
  "ready",
  "drafts",
  "completed",
  "archived",
  "deleted",
];

/**
 * The three that get a TAB. Founder: "The only top tab things should be:
 * Active, Drafts, All engagements."
 *
 * ⚠️ THE OTHER FOUR STILL EXIST — routes, links and the command palette all
 * keep working, and Ready to review / Archived / Recently deleted moved to the
 * "..." menu beside New engagement (which is where Canopy keeps its overflow
 * too). Deleting the tabs without rehoming them would have made Recently
 * Deleted unreachable, and that is a 30-day recovery window with a purge cron
 * on the other side of it.
 *
 * Completed needs no home of its own: All engagements contains it.
 */
// Order is the founder's: "at the top dividers put drafts after All
// engagements." It is Canopy's order too — Active, All Engagements, then
// Drafts — and it reads as narrowest-to-widest-to-unsent rather than putting
// the not-yet-sent pile in the middle of the two live lists.
// The strip, and now the ONLY views this list offers.
export const TAB_VIEWS: EngagementView[] = ["active", "all", "drafts"];

/**
 * The overflow menu, in the order it reads. Ready to review is a slice of live
 * work, Archived and Recently deleted are the two shelves.
 */
// The ⋯, which now holds these TWO and your saved views — nothing else.
//
// "Ready to review" was dropped (founder: "DELETE THEM IN GEENRAL", then "they
// dont exist for tasks"). It was the odd one out: a FILTER dressed as a view,
// and the Status column already answers it. Archived and Recently deleted
// stayed on the founder's own second thought — "maybe a recently deleted and
// archived should stay" — because they are not filters at all. They are
// SHELVES: different lifecycle scopes with their own database reads, and
// Recently deleted is a 30-day recovery window with a purge cron on the far
// side of it. Unreachable there would mean unrecoverable.
export const MENU_VIEWS: EngagementView[] = ["archived", "deleted"];

// Which DB lifecycle scope a view needs loaded. Most views read the "active"
// set (not archived, not deleted); Archived and Recently Deleted read their
// own scopes. The loader is React.cache'd per scope, so every active-scope view
// + the sidebar badges share one query.
export function scopeForView(view: EngagementView): EngagementScope {
  if (view === "archived") return "archived";
  if (view === "deleted") return "deleted";
  // "all" is every engagement that is neither archived nor deleted — the same
  // scope the working list loads, without the status slice on top. It is NOT
  // "everything in the database": a deleted engagement is on its way out and an
  // archived one was deliberately put away, so neither belongs in the list you
  // scan every morning. Canopy draws the same line.
  return "active";
}

// The route a view lives at. Single source of truth for the All-Engagements
// sub-page URLs — the sidebar nav and the engagement breadcrumb both resolve a
// view to its href through here, so the links never drift. Active is the
// section root (/engagements); every other view is /engagements/<view>.
export function viewHref(view: EngagementView): string {
  return view === "active" ? "/engagements" : `/engagements/${view}`;
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
//   all       → every non-archived, non-deleted row, any status
//   ready     → readyToReview (all required docs in, awaiting review)
//   drafts    → draft only
//   completed → complete
//   archived  → whatever the archived scope returned (status-agnostic)
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
    case "all":
      // No status slice — completed and cancelled work included. This is what
      // replaced the Completed tab: one list you can sort and filter with the
      // column menus, rather than a tab per lifecycle state.
      return rows;
    case "ready":
      return rows.filter((r) => r.readyToReview);
    case "drafts":
      return rows.filter((r) => r.status === "draft");
    case "completed":
      return rows.filter((r) => r.status === "complete");
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
