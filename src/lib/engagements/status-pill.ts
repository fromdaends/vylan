import type { DerivedEngagementStatus } from "@/lib/attention";

// Shared rendering rules for the unified engagement status pill, used by every
// surface that shows one (Overview table, engagement header, client pages).
// Plain lib module (no "use client") so server and client components can both
// import it without crossing a client boundary.

// Badge variant for a unified status. "ready_to_review" uses the secondary
// shape + READY_PILL_CLASS on top for its success tint.
export function engagementStatusVariant(
  status: DerivedEngagementStatus | "approved" | "rejected" | "na",
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "complete" || status === "approved") return "default";
  if (status === "cancelled" || status === "rejected") return "destructive";
  if (status === "draft" || status === "na") return "outline";
  return "secondary";
}

// "Ready to review" is the action state — success-tinted, visually distinct
// from the neutral "In progress", matching the green tone the Needs-attention
// "ready" badge already uses.
export const READY_PILL_CLASS =
  "border-transparent bg-success/15 text-success [a&]:hover:bg-success/20";

// The className for a status pill: the ready tint when applicable, else none.
export function engagementStatusPillClass(
  status: DerivedEngagementStatus,
): string | undefined {
  return status === "ready_to_review" ? READY_PILL_CLASS : undefined;
}
