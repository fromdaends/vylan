import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

// /home has been retired. Its surfaces — the greeting, the global search,
// and the "What's new" feed — now live on /dashboard, which is the
// post-login landing. This route stays as a permanent redirect so old
// links, bookmarks, and any lingering references still resolve.
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  redirect(getPathname({ locale, href: "/dashboard" }));
}
