// INSIGHTS — the firm's money picture: revenue, hours, estimated per-client
// profitability. PURE ARITHMETIC over real data (lib/insights/metrics.ts,
// tested); no AI anywhere on this page, by explicit product rule.
//
// GATED ON THE CAPABILITY, NOT THE OWNER RANK — the founder's "roles only"
// ruling. can(user, "insights.view") decides; every owner holds it
// automatically, and a senior manager can be granted it through a role. A
// staff member hitting the URL directly gets the app's standard notFound —
// the same treatment /settings/audit gives (a page that admits it exists but
// refuses is an invitation to wonder what's behind it).
//
// The page is also DEFENDED IN DEPTH: even if this guard were deleted, the
// cost table behind the numbers (time_entry_costs) answers [] to sessions
// without the capability — RLS, not the router, is the boundary.

export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { isTimeInsightsEnabled } from "@/lib/time/flags";
import { loadInsights } from "@/lib/insights/load";
import { toInsightsRange } from "@/lib/insights/metrics";
import {
  InsightsView,
  type InsightsTab,
} from "@/components/insights/insights-view";

function toTab(v: unknown): InsightsTab {
  return v === "clients" || v === "team" ? v : "overview";
}

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; range?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) notFound();
  if (!isTimeInsightsEnabled(firm)) notFound();
  if (!can(user, "insights.view")) notFound();

  const range = toInsightsRange(sp.range);
  const data = await loadInsights(firm, range);

  return <InsightsView data={data} tab={toTab(sp.tab)} range={range} />;
}
