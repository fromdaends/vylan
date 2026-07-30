import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

// The Integrations hub MOVED INTO SETTINGS (founder: "move the integrations
// completely into settings, no point in it being in the sidebar"). The rail tab
// is gone and the connection cards now render in Settings > Integrations.
//
// This index stays purely as a redirect, never as a page: old bookmarks, the
// "connection broken" notification, search results and any OAuth callback that
// falls back here still land on the real hub instead of a 404. The per-tool
// pages beneath it (/integrations/quickbooks, /xero, /sage, /filing) are
// unchanged — they're the destinations the cards open.
export default async function IntegrationsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  redirect(`${getPathname({ locale, href: "/settings" })}?tab=integrations`);
}
