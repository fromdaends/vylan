// The standalone /demo questionnaire was the OLD-design version of the demo
// flow. The public landing now hosts the canonical blue lead form in-page
// (#vy-get-access) — same 3-step saveDemoStep pipeline + cal.com booking — so
// /demo simply forwards there. One demo experience, one (blue) design.
// (Any lingering link or bookmark to /demo lands on the new form; signed-in
// visitors are sent on to /dashboard by the landing itself.)

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

export default async function DemoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  redirect(`${getPathname({ locale, href: "/" })}#vy-get-access`);
}
