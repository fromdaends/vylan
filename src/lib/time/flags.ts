// The time_insights feature switch (migration 1750, firms.time_insights_enabled).
//
// Same polarity rule as workflow/flags.ts: it gates a NEW behaviour, so a
// missing column (migration not applied), an absent value, or anything that is
// not an explicit `true` reads as OFF. Only deliberate enablement turns
// anything on.
//
// Unlike the workflow flags this takes the FIRM OBJECT rather than querying:
// every caller (the app layout, the engagement page, the client page, the team
// page) already holds the React.cache'd getCurrentFirm() result, and the
// column rides its `select("*")` — a second query per render would buy
// nothing.

export function isTimeInsightsEnabled(
  firm: { time_insights_enabled?: boolean | null } | null | undefined,
): boolean {
  return firm?.time_insights_enabled === true;
}
