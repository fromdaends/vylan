import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";

// Per-plan pages are retired alongside /pricing (sales-led demo model).
// Any /pricing/<plan> URL now redirects to the landing page. Plan data
// (src/lib/plans.ts) + the detail UI remain in git history for if/when
// self-serve billing returns.
export default async function PlanPage({
  params,
}: {
  params: Promise<{ locale: string; plan: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  redirect(getPathname({ locale, href: "/" }));
}
