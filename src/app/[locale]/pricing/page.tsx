import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

// Pricing is retired from the public marketing site (founder runs a
// sales-led, demo-first pricing model — see the "Replace everything"
// landing rebuild). The route stays so old links / bookmarks don't 404;
// it just sends visitors to the landing page, where the lead form is the
// front door. The previous "talk to us" pricing UI + the paid-plan grid
// (paid-pricing.tsx) are preserved in git history if billing ever flips
// back to self-serve.
export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  redirect(getPathname({ locale, href: "/" }));
}
