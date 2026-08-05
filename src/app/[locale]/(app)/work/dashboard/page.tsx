// Moved to /work/overview.
//
// Founder: "instead of calling a dashboard, call it work overview because
// we're gonna implement new dashboards, like one for client stuff as well."
// Right — once there are several, "Dashboard" stops naming anything.
//
// A REDIRECT rather than a delete: this URL was live for the length of one
// deploy and is sitting in at least one open tab.
export const dynamic = "force-dynamic";

import { redirect } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

export default async function MovedWorkDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  redirect({ href: "/work/overview", locale: assertLocale(rawLocale) });
}
