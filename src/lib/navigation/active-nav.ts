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

// The Integrations section spans TWO URL roots: the hub index (/integrations,
// which also holds the Sage export at /integrations/sage) and the pre-existing
// QuickBooks surface (/quickbooks/drafts). The sidebar's expandable Integrations
// parent lights up (and stays expanded) on either, so the rule lives here rather
// than being re-derived in the component. QuickBooks and Sage are independent
// features; this only unifies the NAV highlight, nothing else.
export function isIntegrationsSectionActive(pathname: string): boolean {
  return (
    isNavItemActive(pathname, "/integrations") ||
    isNavItemActive(pathname, "/quickbooks")
  );
}

// Which Integrations sub-items belong in the sidebar for a given connection
// state. Sage 50 is a file export that needs NO connection, so it's ALWAYS
// present; the QuickBooks sub-item appears only once the firm has actually
// connected a client's QuickBooks. This mirrors the Integrations hub page, which
// always renders the Sage card but gates the QuickBooks card the same way.
//
// The Integrations SECTION itself is always shown (Sage is always available), so
// this predicate is the only place connection state narrows what's in the nav —
// it never hides the whole section, only the QuickBooks row. Keeping it here
// (pure, no React) keeps the sidebar and its unit tests in one source of truth.
export function isIntegrationSubItemVisible(
  key: string,
  quickbooksConnected: boolean,
): boolean {
  // Both current integrations are ALWAYS listed: Sage 50 is a file export, and
  // QuickBooks now shows even before connecting — the drafts page then guides the
  // owner to connect from a client's page — so it's DISCOVERABLE instead of hidden
  // (the founder's call). An unknown/future integration falls back to the
  // connection flag rather than assuming it should show.
  return key === "quickbooks" || key === "sage" || quickbooksConnected;
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
//   Recently deleted > Archived > Ready to review > Completed > Drafts > Active
// `readyToReview` is supplied by the caller (computed via the same
// isReadyToReview(computeAttention(...)) the worklist uses) because it depends
// on request-item state, not on the engagement row alone.
//
// A 'cancelled' engagement has no view of its own (see lib/engagements/views.ts)
// and so has no sub-item to light up. It falls through to "active" — a legacy
// cancelled row is reachable only through the command palette, and highlighting
// the section root is a better answer there than highlighting nothing.
export function engagementToView(
  e: EngagementForView,
  opts: { readyToReview: boolean },
): EngagementView {
  if (isDeletedEngagement(e)) return "deleted";
  if (isArchivedEngagement(e)) return "archived";
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
