import { getTranslations, setRequestLocale } from "next-intl/server";
import { listClients } from "@/lib/db/clients";
import { listTemplates } from "@/lib/db/templates";
import { EngagementBuilder } from "@/components/engagements/engagement-builder";
import { assertLocale } from "@/lib/locale";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default async function NewEngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ client?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [clients, templates] = await Promise.all([
    listClients({ includeArchived: false }),
    listTemplates(),
  ]);

  const t = await getTranslations("Engagements");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  return (
    <div className="space-y-6 max-w-3xl">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_engagements"), href: "/engagements" },
          { label: t("new_title") },
        ]}
      />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("new_title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("new_subtitle")}
        </p>
      </header>
      <EngagementBuilder
        clients={clients.map((c) => ({
          id: c.id,
          display_name: c.display_name,
          type: c.type,
          email: c.email,
        }))}
        templates={templates}
        initialClientId={sp.client}
        locale={locale}
      />
    </div>
  );
}
