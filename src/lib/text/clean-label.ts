// Em dashes read as AI slop, so we never show them — even if older seeded
// data still contains them. Collapse "X — Y" to "X Y" at render time (the
// seed migrations also clean the underlying data).
//
// Lives in a NEUTRAL module on purpose: it started life inside the
// template-card client component, and a value exported from a "use client"
// file becomes a stub when a Server Component imports it (the repo's own
// documented footgun). Server pages (breadcrumbs, titles) need this too.
export function cleanLabel(s: string): string {
  return s.replace(/\s*—\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}
