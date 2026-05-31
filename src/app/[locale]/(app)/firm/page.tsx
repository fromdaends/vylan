import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

// Firm settings moved into Settings → Account. Keep this route as a redirect so
// old bookmarks / links (and any avatar-menu entry that still points here)
// still land in the right place. Build the localized /settings path, then
// append the ?tab deep-link (getPathname takes a clean pathname).
export default async function FirmPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  const settingsPath = getPathname({ locale, href: "/settings" });
  redirect(`${settingsPath}?tab=account`);
}
