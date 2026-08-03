// Which facet of a client the page is showing.
//
// The client page used to be every section stacked down one scroll — contact
// details, who can see it, engagements, bookkeeping, payments — so finding the
// engagement list meant scrolling past a phone number. Canopy splits a client
// into tabs, one per thing, and that is what these are.
//
// A PLAIN module, not part of a "use client" file: the page is a Server
// Component and CALLS parseClientTab, and a client-module export would hand it
// a client reference that throws at request time (the #959 lesson).

export const CLIENT_TABS = [
  "overview",
  "engagements",
  // The firm's people on this client. Named ORGANIZERS, not Team: "team" reads
  // as the firm's own staff list (which is a different page), and the founder
  // asked for the Canopy word.
  "organizers",
  "bookkeeping",
  // The firm's file browser, hosted here rather than linked away to. The
  // founder: "get rid of file archive — file archive exists purely within the
  // files on a client's page." It is the SAME component /files renders, locked
  // to this client, not a client-shaped imitation of it.
  "files",
] as const;

export type ClientTab = (typeof CLIENT_TABS)[number];

// Unknown / absent / junk all land on the overview rather than erroring: a URL
// someone hand-edited or an old bookmark should show the client, not a 404.
export function parseClientTab(value: string | null | undefined): ClientTab {
  return (CLIENT_TABS as readonly string[]).includes(value ?? "")
    ? (value as ClientTab)
    : "overview";
}

// The tab's href. Overview is the bare client URL — the default view should not
// need a query string, so a link to a client is a link to their overview.
export function clientTabHref(clientId: string, tab: ClientTab): string {
  return tab === "overview"
    ? `/clients/${clientId}`
    : `/clients/${clientId}?tab=${tab}`;
}

// ── The Engagements tab's lifecycle filter ──────────────────────────────────
//
// The same four slices the /engagements section has in its sidebar, reduced to
// the ones that mean something on ONE client. Dropped: "drafts" (a draft is a
// state on the way to Active, and the Active list already contains them) and
// "deleted" (the 30-day trash is a firm-level chore, not part of reading a
// client).
//
// This is a SERVER-side filter, not a client-side one: archived engagements are
// a different database scope entirely, so which of these is chosen decides what
// gets loaded. That is exactly why it lives in the URL beside ?tab= instead of
// in the table's own React state.
export const CLIENT_ENGAGEMENT_VIEWS = [
  "active",
  "ready",
  "completed",
  "archived",
] as const;

export type ClientEngagementView = (typeof CLIENT_ENGAGEMENT_VIEWS)[number];

// Its own param name (`ev`), NOT `view` or `stage`: /files already reads a
// `tab`, /engagements reads `stage` + `sort` + `dir`, and a client page linking
// into either would otherwise hand it a param that means something else there.
export const CLIENT_ENGAGEMENT_VIEW_PARAM = "ev";

// Junk falls back to Active — the working list, and the one worth defaulting to
// when a link is stale.
export function parseClientEngagementView(
  value: string | null | undefined,
): ClientEngagementView {
  return (CLIENT_ENGAGEMENT_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as ClientEngagementView)
    : "active";
}

export function clientEngagementViewHref(
  clientId: string,
  view: ClientEngagementView,
): string {
  const base = `/clients/${clientId}?tab=engagements`;
  return view === "active"
    ? base
    : `${base}&${CLIENT_ENGAGEMENT_VIEW_PARAM}=${view}`;
}

// ── The Bookkeeping tab's working lists ─────────────────────────────────────
//
// The firm-wide Bookkeeping page shows these two as tabs of one panel, and for
// the same reason they are tabs here rather than both on screen at once: each
// is a LIVE read of the client's ledger, so rendering both would make every
// visit to this tab pay for two QuickBooks scans when you only ever read one.
//
// The month-end close sits above them and is not a tab — it costs database
// reads only, and it is the thing you came to look at.
export const CLIENT_BOOKKEEPING_VIEWS = ["receipts", "uncategorized"] as const;

export type ClientBookkeepingView = (typeof CLIENT_BOOKKEEPING_VIEWS)[number];

// Its own param name (`bk`), for exactly the reason `ev` above has one: this
// page already spends `tab` on its own tab row, and the shared components
// rendered inside it write `client`, `from`, `to` and `period` of their own.
// A second `tab` would navigate you off the client page mid-click.
export const CLIENT_BOOKKEEPING_VIEW_PARAM = "bk";

export function parseClientBookkeepingView(
  value: string | null | undefined,
): ClientBookkeepingView {
  return (CLIENT_BOOKKEEPING_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as ClientBookkeepingView)
    : "receipts";
}

export function clientBookkeepingViewHref(
  clientId: string,
  view: ClientBookkeepingView,
  // The month currently on the close board above, carried across so switching
  // list does not silently reset which month you were closing.
  period?: string,
): string {
  const base = `/clients/${clientId}?tab=bookkeeping`;
  const parts = [
    view === "receipts" ? "" : `${CLIENT_BOOKKEEPING_VIEW_PARAM}=${view}`,
    period ? `period=${period}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `${base}&${parts.join("&")}` : base;
}
