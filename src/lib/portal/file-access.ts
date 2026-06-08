// The ONE rule that decides whether the unauthenticated client portal may serve
// a given uploaded file's bytes / thumbnail. The portal is reached only via a
// magic token, and a client must be able to see ONLY the files belonging to the
// single engagement that token unlocks — never another firm's or another
// client's documents (which hold SINs and tax records).
//
// Kept PURE and exhaustively unit-tested so the access rule is one source of
// truth that can be proven, not just hidden in the UI. The route fetches the
// engagement (by magic_token) and the file (by id) with the service-role client,
// then calls this; it serves bytes only when this returns true, and returns an
// indistinguishable 404 otherwise (no existence oracle).

export type PortalEngagementRow = {
  id: string;
  status: string;
  magic_expires_at: string | null;
} | null;

export type PortalFileRow = {
  engagement_id: string;
} | null;

export function isPortalFileAccessAllowed(input: {
  // Result of isValidTokenShape(token) — a malformed token never hits the DB.
  tokenShapeValid: boolean;
  // The engagement the token resolved to, or null if no engagement matched.
  engagement: PortalEngagementRow;
  // The requested file row, or null if no file matched that id.
  file: PortalFileRow;
  now?: Date;
}): boolean {
  const { tokenShapeValid, engagement, file } = input;
  const now = input.now ?? new Date();

  if (!tokenShapeValid) return false;
  if (!engagement) return false;
  // A cancelled engagement is revoked — the portal as a whole is closed.
  if (engagement.status === "cancelled") return false;
  // Expired magic link.
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < now
  ) {
    return false;
  }
  if (!file) return false;
  // The decisive check: the file must belong to THIS engagement. This is what
  // stops a valid token from reading any other engagement's documents by id.
  if (file.engagement_id !== engagement.id) return false;

  return true;
}
