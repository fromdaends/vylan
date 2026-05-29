import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { AllEngagements } from "@/components/engagements/all-engagements";
import { getCurrentUser } from "@/lib/db/users";
import { canDeleteEngagements } from "@/lib/engagements/lifecycle";

export const dynamic = "force-dynamic";

// /engagements — the full engagement list, reached via the dashboard's
// "Browse all" link. Shows every engagement (any status) with search.
export default async function EngagementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [rows, user] = await Promise.all([
    loadEngagementWorklist(),
    getCurrentUser(),
  ]);
  const t = await getTranslations("Dashboard");
  const canDelete = user ? canDeleteEngagements(user.role) : false;

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t("wl_all_title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("wl_all_subtitle")}</p>
      </header>

      <AllEngagements rows={rows} locale={locale} canDelete={canDelete} />
    </div>
  );
}
