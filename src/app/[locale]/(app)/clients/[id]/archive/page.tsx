import { redirect } from "next/navigation";
import { assertLocale } from "@/lib/locale";
import { clientTabHref } from "@/lib/clients/tabs";

// The client document archive USED to be a page of its own. It isn't any more.
//
// Founder: "get rid of file archive — file archive exists purely within the
// files on a client's page." So the client's Files TAB now hosts the real file
// browser (the same component /files renders, locked to this client), and the
// "Download everything" ZIP button moved onto it.
//
// This route stays as a REDIRECT rather than being deleted: it is linked from
// the clients table's row menu, from older emails, and from whatever anyone
// bookmarked. A 404 for a page whose content still exists — just somewhere
// better — would read as data loss.
//
// What went with the old page: its by-ENGAGEMENT grouping. The browser groups
// by year and category (the folder structure the filing engine actually
// writes), which is the organisation the rest of the product uses. Flagged in
// the PR so it can come back as a view if it turns out to be missed.
export default async function ClientArchiveRedirect({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  // Locale-prefixed by hand: this is next/navigation's redirect, which knows
  // nothing about the i18n routing the app's own Link goes through.
  redirect(`/${locale}${clientTabHref(id, "files")}`);
}
