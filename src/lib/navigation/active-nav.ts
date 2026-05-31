// Centralized sidebar active-state rules. One source of truth so every nav
// surface (the desktop rail, the collapsed rail, the mobile tab bar) and every
// detail page agree on what "you are here" means — instead of each re-deriving
// the rule inline (which had already drifted into three slightly different
// copies). Pure: no React, no server imports, so it's trivially unit-tested.

import {
  isArchivedEngagement,
  isDeletedEngagement,
} from "@/lib/engagements/lifecycle";
import { viewHref, type EngagementView } from "@/lib/engagements/views";

// Is a top-level nav item active for the current path? Overview (/dashboard) is
// a leaf route — exact match only, so it doesn't light up on every sub-route.
// Every other section lights on its own page AND anything nested beneath it
// (/clients, /clients/[id], /clients/import all activate Clients). The trailing
// "/" guard keeps /engagements from being matched by an unrelated route that
// merely shares the prefix (e.g. a hypothetical /engagements-archive).
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

// The lifecycle + status fields needed to classify a single engagement. A full
// Engagement row satisfies this structurally, so callers can pass one directly.
export type EngagementForView = {
  status: "draft" | "sent" | "in_progress" | "complete" | "cancelled";
  archived_at: string | null;
  deleted_at: string | null;
};

// Which All-Engagements sub-page a single engagement belongs to — so a detail
// page can tell the sidebar which sub-item to highlight. Reuses the SAME
// lifecycle predicates the list pages use (no duplicated filtering logic).
// Priority, most specific first (per the nav-consistency spec):
//   Recently deleted > Archived > Cancelled > Ready to review > Completed >
//   Drafts > Active
// `readyToReview` is supplied by the caller (computed via the same
// isReadyToReview(computeAttention(...)) the worklist uses) because it depends
// on request-item state, not on the engagement row alone.
export function engagementToView(
  e: EngagementForView,
  opts: { readyToReview: boolean },
): EngagementView {
  if (isDeletedEngagement(e)) return "deleted";
  if (isArchivedEngagement(e)) return "archived";
  if (e.status === "cancelled") return "cancelled";
  if (opts.readyToReview) return "ready";
  if (e.status === "complete") return "completed";
  if (e.status === "draft") return "drafts";
  return "active"; // sent / in_progress, not yet ready to review
}

// Is an Engagements sub-view active? On a list sub-page it's an exact route
// match. On an engagement detail page (/engagements/[id]) there's no view in
// the URL, so the detail page publishes the engagement's computed view via
// context (`detailView`) and we light the sub-item that matches it.
export function isEngagementViewActive(
  pathname: string,
  view: EngagementView,
  detailView?: EngagementView | null,
): boolean {
  if (detailView != null) return detailView === view;
  return pathname === viewHref(view);
}
