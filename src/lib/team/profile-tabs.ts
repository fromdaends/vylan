// Which facet of a teammate the profile page is showing.
//
// The same split the client page already has, for the same reason: the page had
// grown into one long scroll — about, roles, permissions, removal, their work,
// their clients, their history — so reaching anything meant scrolling past
// something heavier. The founder asked for the client page's treatment here
// too ("same thing applies for when viewing members page").
//
// A PLAIN module, not part of a "use client" file: the page is a Server
// Component and CALLS these, and a client-module export would hand it a client
// reference that throws at request time (the #959 lesson).

export const TEAM_PROFILE_TABS = [
  "overview",
  "engagements",
  "clients",
  // Owner-only, and the page drops it from the row for everyone else — the
  // activity feed mirrors /settings/audit's visibility, not the profile's.
  "activity",
  // What this person is allowed to do, and where each permission comes from.
  // The client page's Organizers tab answers "who can see this and why"; this
  // is the same question asked of a person instead of a client. Owner-only:
  // the controls on it are owner-only anyway, and a tab that renders three
  // empty panels for staff is worse than no tab.
  "access",
] as const;

export type TeamProfileTab = (typeof TEAM_PROFILE_TABS)[number];

// Unknown / absent / junk all land on the overview rather than erroring: a URL
// someone hand-edited or an old bookmark should show the person, not a 404.
export function parseTeamProfileTab(
  value: string | null | undefined,
): TeamProfileTab {
  return (TEAM_PROFILE_TABS as readonly string[]).includes(value ?? "")
    ? (value as TeamProfileTab)
    : "overview";
}

// The tab's href. Overview is the bare profile URL — the default view should
// not need a query string, so a link to a teammate is a link to their overview.
//
// `tab`, matching the client page. The lifecycle filter on the Engagements tab
// keeps its OWN long-standing `view` param, so an existing bookmark of
// /settings/team/<id>?view=completed still lands where it always did.
export function teamProfileTabHref(
  userId: string,
  tab: TeamProfileTab,
): string {
  return tab === "overview"
    ? `/settings/team/${userId}`
    : `/settings/team/${userId}?tab=${tab}`;
}
