import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { HOW_IT_WORKS_PUBLIC } from "@/lib/marketing-nav";

// The manifesto has been retired and replaced by the "How it works" page.
// We keep this route as a redirect (rather than deleting it) so any existing
// bookmark or inbound link to /manifesto lands on the new page instead of a
// dead 404. All in-app links now point straight at /how-it-works.
export default async function ManifestoRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  // Normally forwards to /how-it-works. While that page is hidden it would
  // be forwarding to a 404, so it goes to the front page instead.
  redirect(
    getPathname({
      locale,
      href: HOW_IT_WORKS_PUBLIC ? "/how-it-works" : "/",
    }),
  );
}
