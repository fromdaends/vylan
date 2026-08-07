import { redirect } from "next/navigation";

// The Time page moved to /time.
//
// ── WHY THIS FILE IS A REDIRECT AND NOT A DELETION ─────────────────────────
//
// This was the weekly timesheet (timer v2). The redesign replaced it with the
// week / day / month page at /time — one Time surface, not two, which is the
// point of the handoff's own instruction to "restructure the existing Time page
// if one exists".
//
// It stays as a redirect because the path is a year of muscle memory and
// whatever anybody has bookmarked. `?person` and `?date` are carried through so
// a saved link at somebody else's week still lands on that week.
export default async function WorkTimeRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["person", "date", "view"]) {
    const v = sp[key];
    if (typeof v === "string" && v) params.set(key, v);
  }
  const qs = params.toString();
  redirect(qs ? `/time?${qs}` : "/time");
}
