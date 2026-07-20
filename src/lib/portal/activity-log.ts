// Client-side portal activity logging. The portal is unauthenticated (the magic
// token IS the identity), so these fire-and-forget POSTs let the accountant's
// Activity feed + audit log capture what the client actually does in the portal:
// opening it, moving between sections, viewing/downloading a final document.
// Best-effort by design — a failed log must never disrupt the client's session.

// The actions the portal is allowed to log. MUST stay in sync with the server
// allowlist in /api/portal/activity/route.ts and the timeline/audit labels.
export type PortalActivityAction =
  | "client_viewed_portal"
  | "client_opened_documents"
  | "client_opened_signatures"
  | "client_opened_messages"
  | "client_opened_signature"
  | "client_downloaded_deliverable";

// Only these metadata fields are read server-side (a bounded string each), so
// the type here mirrors what actually gets stored.
export type PortalActivityMetadata = {
  // Human-readable label for the thing acted on (a filename, a signature label).
  name?: string;
  // An opaque id (file/item id) for cross-referencing, if useful.
  ref?: string;
};

// Fire-and-forget. `keepalive` lets the request survive a navigation that a
// click may trigger (e.g. downloading a deliverable). Never throws.
export function logPortalActivity(
  token: string,
  action: PortalActivityAction,
  metadata?: PortalActivityMetadata,
): void {
  if (!token) return;
  try {
    void fetch("/api/portal/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action, metadata }),
      keepalive: true,
    }).catch(() => {
      // Swallow network errors — logging is best-effort.
    });
  } catch {
    // Never let logging throw into the portal UI.
  }
}
