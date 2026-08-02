// Moved onto the Bookkeeping page.
//
// These three screens each used to be their own route, reached by a grey text
// link in the corner of the drafts queue. They are now sections and tabs of
// /quickbooks/drafts, so this route only exists to keep old links, bookmarks and
// anything already sent to a teammate working.

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
  // Carry the query through: a link to one client's missing receipts should
  // still land on that client's missing receipts.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
  }
  qs.set("tab", "documents");
  redirect({ href: `/quickbooks/drafts?${qs.toString()}`, locale });
}
