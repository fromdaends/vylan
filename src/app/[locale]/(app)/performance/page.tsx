import { redirect } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

// The Performance page is retired. What was on it either moved or was replaced:
//
//   Money (collected / outstanding / time to paid + the chart)  ->  /billing
//       Billing's stat strip answers the same questions against live invoices
//       rather than a retrospective aggregate. The chart was deliberately not
//       ported.
//   Documents (and the Money / Documents toggle)                ->  removed
//   AI performance + What Vylan did automatically               ->  /vylan?tab=ai
//
// A REDIRECT, not a 404. This page sat in the sidebar for months, so it is in
// bookmarks and in muscle memory. The AI numbers are the half a person coming
// back here is most likely after, so that is where they land.
//
// No data or tracking was deleted — only surfaces. The underlying stats keep
// accumulating, and lib/performance/{money,documents}.ts are still there,
// unreferenced, so nothing has to be rebuilt if the numbers are ever wanted
// again.
export const dynamic = "force-dynamic";

export default async function RetiredPerformancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  redirect({ href: "/vylan?tab=ai", locale: assertLocale(rawLocale) });
}
