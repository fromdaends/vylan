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
