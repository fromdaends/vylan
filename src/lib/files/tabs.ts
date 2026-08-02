// Which Files tab a URL lands on.
//
// Home is the new default — but only for a BARE /files. Every deep link that
// existed before the Home tab (Clients page cross-links, engagement rows,
// "View in Files" menus) points at /files?client=… with no tab param, relying
// on Browse having been the default. Those links must keep landing on Browse:
// a person clicking "view this client's files" wants the files, not a
// dashboard. So any browse-state param implies Browse, and no existing link
// anywhere needs to change.

export type FilesTab = "home" | "browse" | "settings";

/** Every query param that describes a position INSIDE Browse. */
const BROWSE_STATE_KEYS = [
  "client",
  "folder",
  "year",
  "category",
  "q",
  "type",
  "status",
  "sort",
  "page",
] as const;

export function resolveFilesTab(
  sp: Record<string, string | undefined>,
): FilesTab {
  if (sp.tab === "settings") return "settings";
  if (sp.tab === "browse") return "browse";
  if (sp.tab === "home") return "home";
  return BROWSE_STATE_KEYS.some((k) => !!sp[k]?.trim()) ? "browse" : "home";
}
