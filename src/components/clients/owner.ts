// Owner ("belongs to") filter for the /clients page. Lives in a neutral
// (non-"use client") module so the server-rendered page (which validates the
// `owner` URL param and runs the filter) and the client toolbar (which renders
// the dropdown) can both import these without crossing the server/client
// boundary — same reason sort.ts exists (see the SORT_OPTIONS 500 regression).

export const OWNER_FILTERS = ["all", "mine"] as const;
export type OwnerFilter = (typeof OWNER_FILTERS)[number];

// Resolved owner info for a client row's badge. avatarUrl is pre-resolved on
// the server (getBrandingImageUrl) so the client component just renders it.
export type ClientOwner = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

// Filter clients by owner. "all" passes everything through; "mine" keeps only
// clients whose assigned_user_id matches the current user. Unassigned clients
// (assigned_user_id null) never match "mine".
export function filterClientsByOwner<
  T extends { assigned_user_id: string | null },
>(clients: T[], filter: OwnerFilter, currentUserId: string): T[] {
  if (filter !== "mine") return clients;
  return clients.filter((c) => c.assigned_user_id === currentUserId);
}
