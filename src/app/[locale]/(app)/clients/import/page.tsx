import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { CsvImportClient } from "./csv-import-client";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Clients");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  return (
    <div className="space-y-6 max-w-3xl">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_clients"), href: "/clients" },
          { label: t("import_title") },
        ]}
      />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("import_title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("import_subtitle")}
        </p>
      </header>
      <CsvImportClient locale={locale} />
    </div>
  );
}
