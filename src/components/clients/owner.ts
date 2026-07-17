// Owner ("belongs to") filter for the /clients page. Lives in a neutral
// (non-"use client") module so the server-rendered page (which validates the
// `owner` URL param and runs the filter) and the client toolbar (which renders
// the dropdown) can both import these without crossing the server/client
// boundary — same reason sort.ts exists (see the SORT_OPTIONS 500 regression).

// The two built-in owner filters. A filter value may ALSO be a specific firm
// member's id (chosen from the toolbar or arrived via ?owner=<id>), so the
// filter type below is a plain string — these two are just the named defaults.
export const OWNER_FILTERS = ["all", "mine"] as const;
export type OwnerFilter = (typeof OWNER_FILTERS)[number];

export function isBuiltinOwnerFilter(v: string): v is OwnerFilter {
  return (OWNER_FILTERS as readonly string[]).includes(v);
}

// Resolved owner info for a client row's badge. avatarUrl is pre-resolved on
// the server (getBrandingImageUrl) so the client component just renders it.
export type ClientOwner = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

// Filter clients by owner. "all" passes everything through; "mine" keeps only
// the current user's clients; any other value is a specific member's id and
// keeps only that member's clients. Unassigned clients (assigned_user_id null)
// never match "mine" or a member id.
export function filterClientsByOwner<
  T extends { assigned_user_id: string | null },
>(clients: T[], filter: string, currentUserId: string): T[] {
  if (filter === "all") return clients;
  const targetUserId = filter === "mine" ? currentUserId : filter;
  return clients.filter((c) => c.assigned_user_id === targetUserId);
}
