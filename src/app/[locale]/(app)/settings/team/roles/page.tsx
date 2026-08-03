// Moved onto the firm page as a tab.
//
// Roles was its own route, reached only from the firm name's dropdown. That put
// it on the wrong side of this page's rule — a PLACE you look at is a tab, a
// thing you DO is in the dropdown, and nothing is in both — so it is now
// /settings/team?tab=roles and the dropdown item is gone.
//
// This route stays as a REDIRECT rather than a deletion: it is what the
// dropdown pointed at for weeks, so it is in browser history, in bookmarks, and
// in any link already sent to a teammate. Same treatment /clients/[id]/archive
// got when the Files tab absorbed it (#1168).

import { redirect } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

export default async function MovedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  const sp = await searchParams;
  // Carry the query through: a link to ONE role should still land on that role,
  // not on whichever one happens to sort first.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
  }
  qs.set("tab", "roles");
  redirect({ href: `/settings/team?${qs.toString()}`, locale });
}
