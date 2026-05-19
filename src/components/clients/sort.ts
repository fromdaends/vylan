// Sort options for the /clients page. Lives in a neutral (non-"use
// client") module so both the server-rendered page (which validates
// the `sort` URL param and runs the actual sort) and the client
// toolbar (which renders the dropdown) can import the constant array
// without crossing the server/client boundary.

export const SORT_OPTIONS = [
  "recent",
  "oldest",
  "name_asc",
  "name_desc",
  "most_engagements",
  "most_active",
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number];
