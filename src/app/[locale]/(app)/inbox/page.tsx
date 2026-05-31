import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

// The Inbox was folded into the Overview (/dashboard) — its "What's new" feed +
// "Needs attention" queue now live there. Keep this route as a redirect so old
// links / bookmarks / the "View all" notifications back-link don't 404.
export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  redirect(getPathname({ locale, href: "/dashboard" }));
}
